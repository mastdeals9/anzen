import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OAuthClientCredentials {
  clientId?: string;
  clientSecret?: string;
}

async function getValidAccessToken(
  supabase: any,
  connection: any,
  oauthClientCredentials: OAuthClientCredentials
): Promise<string> {
  const tokenExpiry = new Date(connection.access_token_expires_at);
  const bufferMs = 5 * 60 * 1000;

  if (!Number.isNaN(tokenExpiry.getTime()) && tokenExpiry.getTime() - bufferMs > Date.now()) {
    return connection.access_token;
  }

  const clientId = oauthClientCredentials.clientId
    || Deno.env.get("GOOGLE_CLIENT_ID")
    || Deno.env.get("GMAIL_CLIENT_ID")
    || "";
  const clientSecret = oauthClientCredentials.clientSecret
    || Deno.env.get("GOOGLE_CLIENT_SECRET")
    || Deno.env.get("GMAIL_CLIENT_SECRET")
    || "";

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth client credentials for token refresh");
  }

  const refreshResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshResponse.ok) {
    const errText = await refreshResponse.text();
    const refreshError = new Error(`Failed to refresh access token: ${errText}`);
    (refreshError as any).code = "TOKEN_REFRESH_FAILED";
    throw refreshError;
  }

  const refreshData = await refreshResponse.json();
  const newExpiry = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

  await supabase
    .from("gmail_connections")
    .update({
      access_token: refreshData.access_token,
      access_token_expires_at: newExpiry,
    })
    .eq("id", connection.id);

  return refreshData.access_token;
}

function encodeBase64Url(str: string): string {
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeMimeWord(str: string): string {
  return `=?utf-8?B?${btoa(unescape(encodeURIComponent(str)))}?=`;
}

interface Attachment {
  filename: string;
  mimeType: string;
  data: string; // base64
}

function buildEmailRaw(
  fromEmail: string,
  fromName: string,
  toEmail: string,
  subject: string,
  htmlBody: string,
  attachments: Attachment[]
): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const fromField = fromName ? `${encodeMimeWord(fromName)} <${fromEmail}>` : fromEmail;
  const encodedSubject = encodeMimeWord(subject);

  if (attachments.length === 0) {
    // Simple HTML email, no attachments
    const lines = [
      `From: ${fromField}`,
      `To: ${toEmail}`,
      `Subject: ${encodedSubject}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=utf-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      btoa(unescape(encodeURIComponent(htmlBody))),
    ];
    return encodeBase64Url(lines.join("\r\n"));
  }

  // Multipart mixed for attachments
  const parts: string[] = [];

  // HTML body part
  parts.push([
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    btoa(unescape(encodeURIComponent(htmlBody))),
  ].join("\r\n"));

  // Attachment parts
  for (const att of attachments) {
    const encodedFilename = encodeMimeWord(att.filename);
    parts.push([
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${encodedFilename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${encodedFilename}"`,
      ``,
      att.data,
    ].join("\r\n"));
  }

  const headers = [
    `From: ${fromField}`,
    `To: ${toEmail}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
  ].join("\r\n");

  const body = parts.join("\r\n") + `\r\n--${boundary}--`;
  return encodeBase64Url(headers + body);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      userId,
      toEmails,
      subject,
      body,
      contactId,
      senderName,
      isHtml,
      attachments,
      googleClientId,
      googleClientSecret,
    } = await req.json();

    if (!userId || !toEmails || !subject || !body) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: connection, error: connectionError } = await supabase
      .from("gmail_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_connected", true)
      .maybeSingle();

    if (connectionError || !connection) {
      return new Response(
        JSON.stringify({ success: false, error: "Gmail not connected. Please connect Gmail in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getValidAccessToken(supabase, connection, {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    });

    const recipientEmails: string[] = Array.isArray(toEmails) ? toEmails : [toEmails];
    // Send to the first valid email of this customer (one individual email per call)
    const toField = recipientEmails[0];

    const htmlContent = isHtml
      ? body
      : `<html><body><pre style="font-family:sans-serif;white-space:pre-wrap">${body}</pre></body></html>`;

    const fileAttachments: Attachment[] = Array.isArray(attachments) ? attachments : [];

    const encodedEmail = buildEmailRaw(
      connection.email_address,
      senderName || "",
      toField,
      subject,
      htmlContent,
      fileAttachments
    );

    const sendResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: encodedEmail }),
    });

    if (!sendResponse.ok) {
      const errorData = await sendResponse.text();
      console.error("Gmail API error:", errorData);
      throw new Error(`Gmail API error: ${errorData}`);
    }

    const result = await sendResponse.json();

    return new Response(
      JSON.stringify({ success: true, messageId: result.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error sending email:", error);
    const isRefreshError = error?.code === "TOKEN_REFRESH_FAILED"
      || String(error?.message || "").includes("Failed to refresh access token");

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to send email",
        code: isRefreshError ? "TOKEN_REAUTH_REQUIRED" : "SEND_FAILED",
        reauthRequired: isRefreshError,
      }),
      {
        status: isRefreshError ? 401 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
