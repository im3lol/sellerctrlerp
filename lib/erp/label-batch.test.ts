import { expect, it } from "vitest";
import { buildLabelBatchDocument } from "./label-batch";
it("groups all physical labels in one escaped, self-contained print document",()=>{
 const html=buildLabelBatchDocument([{itemName:'<script>alert(1)</script>',value:'000123'},{itemName:'صنف',value:'ABC-123'},{itemName:'صنف',value:'ABC-123'}]);
 expect(html.match(/<section class="label">/g)).toHaveLength(3);
 expect(html).toContain('data-label-count="3"');expect(html).toContain('000123');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
 expect(html).toContain('@page{size:50mm 25mm');expect(html).not.toMatch(/<img|<link|<script|url\(/);
});
it("rejects unsupported codes instead of silently printing a different barcode",()=>{
 expect(()=>buildLabelBatchDocument([{itemName:'a',value:'صنف'}])).toThrow('CODE128');
 expect(()=>buildLabelBatchDocument([])).toThrow();
 expect(()=>buildLabelBatchDocument(Array.from({length:5001},()=>({itemName:'a',value:'123'})))).toThrow('5000');
});
