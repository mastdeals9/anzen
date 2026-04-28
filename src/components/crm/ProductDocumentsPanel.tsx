import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Download, ExternalLink, Search } from 'lucide-react';

type CrmProductDocument = {
  id: string;
  inquiry_id: string;
  email_activity_id: string | null;
  product_name: string;
  supplier_name: string | null;
  document_type: 'COA' | 'MSDS' | 'MHD' | 'TDS' | 'SPEC' | 'OTHER';
  storage_path: string;
  display_name: string;
  normalized_key: string;
  version_no: number;
  uploaded_at: string;
  crm_inquiries?: {
    inquiry_number: string;
  }[] | null;
};

const DOC_TYPES: Array<CrmProductDocument['document_type']> = ['COA', 'MSDS', 'MHD', 'TDS', 'SPEC', 'OTHER'];

export function ProductDocumentsPanel() {
  const [documents, setDocuments] = useState<CrmProductDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [productFilter, setProductFilter] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [documentTypeFilter, setDocumentTypeFilter] = useState('all');

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('crm_product_documents')
        .select('id, inquiry_id, email_activity_id, product_name, supplier_name, document_type, storage_path, display_name, normalized_key, version_no, uploaded_at, crm_inquiries(inquiry_number)')
        .order('uploaded_at', { ascending: false })
        .limit(300);

      if (error) throw error;
      setDocuments(((data || []) as unknown as CrmProductDocument[]));
    } catch (error) {
      console.error('Failed to load CRM product documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredDocuments = useMemo(() => {
    const product = productFilter.trim().toLowerCase();
    const supplier = supplierFilter.trim().toLowerCase();

    return documents.filter((doc) => {
      const productOk = !product || doc.product_name.toLowerCase().includes(product);
      const supplierOk = !supplier || (doc.supplier_name || '').toLowerCase().includes(supplier);
      const typeOk = documentTypeFilter === 'all' || doc.document_type === documentTypeFilter;
      return productOk && supplierOk && typeOk;
    });
  }, [documents, productFilter, supplierFilter, documentTypeFilter]);

  const openDocument = async (doc: CrmProductDocument, download = false) => {
    try {
      const { data, error } = await supabase.storage
        .from('crm-documents')
        .createSignedUrl(doc.storage_path, 60, {
          download: download ? doc.display_name : undefined,
        });

      if (error || !data?.signedUrl) throw error || new Error('No signed URL generated');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to open/download document:', error);
      alert('Unable to open document. Please try again.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">CRM Product Documents</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              placeholder="Filter by product"
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              placeholder="Filter by supplier"
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <select
            value={documentTypeFilter}
            onChange={(e) => setDocumentTypeFilter(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All document types</option>
            {DOC_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Product</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Supplier</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Doc Type</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">File</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Version</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Inquiry</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Uploaded</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading documents...</td></tr>
              ) : filteredDocuments.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No documents match current filters.</td></tr>
              ) : filteredDocuments.map((doc) => (
                <tr key={doc.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{doc.product_name}</td>
                  <td className="px-4 py-3 text-gray-700">{doc.supplier_name || '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{doc.document_type}</td>
                  <td className="px-4 py-3 text-gray-700">{doc.display_name}</td>
                  <td className="px-4 py-3 text-gray-700">v{doc.version_no}</td>
                  <td className="px-4 py-3 text-gray-700">{doc.crm_inquiries?.[0]?.inquiry_number || '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{new Date(doc.uploaded_at).toLocaleString('en-GB')}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openDocument(doc, false)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-gray-300 hover:bg-gray-100"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open
                      </button>
                      <button
                        onClick={() => openDocument(doc, true)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-gray-300 hover:bg-gray-100"
                      >
                        <Download className="w-3.5 h-3.5" /> Download
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
