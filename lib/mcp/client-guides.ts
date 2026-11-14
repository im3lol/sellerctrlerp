/** Public connection instructions only. No credentials or tenant identifiers belong here. */
export const MCP_CLIENT_GUIDES = [
  { id: "chatgpt", name: "ChatGPT", kind: "web", docs: "https://developers.openai.com/api/docs/guides/custom-mcp-server", open: "https://chatgpt.com/plugins", steps: ["افتح Plugins في ChatGPT، ثم اضغط + واختر Add custom MCP server.", "اكتب SellerCtrl، والصق عنوان الخادم، واختر OAuth والتسجيل التلقائي DCR.", "أنشئ الاتصال، ثم أكمل موافقة SellerCtrl واختَر الشركة والصلاحيات. فعّل التطبيق في المحادثة."] },
  { id: "claude", name: "Claude", kind: "web", docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp", open: "https://claude.ai", steps: ["افتح Customize ثم Connectors، واضغط Add custom connector.", "اكتب SellerCtrl والصق عنوان الخادم. اختر Sign in now ثم Register automatically.", "أكمل موافقة SellerCtrl واختَر الشركة، ثم فعّل الموصل في المحادثة. في حسابات الفرق قد يلزم أن يضيفه مسؤول المساحة أولًا."] },
  { id: "codex", name: "Codex", kind: "cli", docs: "https://learn.chatgpt.com/docs/extend/mcp?surface=cli", steps: ["افتح Terminal على جهازك وشغّل أمر الإضافة. إذا كان sellerctrl موجودًا بالفعل، استخدم أمر تسجيل الدخول فقط.", "أكمل تسجيل الدخول في المتصفح الخارجي، ثم اختَر الشركة والصلاحيات ووافق.", "ارجع إلى Codex وافتح /mcp للتأكد من الاتصال. قد تحتاج تحديث الجلسة لظهور الأدوات الجديدة."] },
  { id: "claude-code", name: "Claude Code", kind: "cli", docs: "https://code.claude.com/docs/en/mcp", steps: ["شغّل أمر الإضافة في Terminal لتسجيل الخادم في حسابك المحلي.", "داخل Claude Code اكتب /mcp، واختر sellerctrl ثم Authenticate.", "أكمل موافقة SellerCtrl في المتصفح، ثم ارجع إلى Claude Code واختبر الاتصال."] },
  { id: "gemini-cli", name: "Gemini CLI", kind: "cli", docs: "https://geminicli.com/docs/tools/mcp-server/", steps: ["شغّل أمر الإضافة في Terminal على جهاز مثبت عليه Gemini CLI.", "داخل Gemini CLI اكتب /mcp auth sellerctrl وأكمل الدخول في المتصفح.", "اختَر الشركة والصلاحيات، ثم استخدم /mcp list لمراجعة الأدوات. هذه الخطوات تخص Gemini CLI، وليس واجهة Gemini العادية."] },
  { id: "cursor", name: "Cursor", kind: "json", docs: "https://cursor.com/docs/mcp", steps: ["افتح إعدادات MCP في Cursor، وأضف خادمًا خارجيًا بعنوان الخادم الظاهر هنا.", "أو ادمج إعداد JSON التالي داخل ملف .cursor/mcp.json الموجود لديك. لا تستبدل الخوادم الأخرى.", "اضغط Connect أو Authenticate بجوار sellerctrl، ثم أكمل موافقة SellerCtrl في المتصفح."] },
  { id: "vscode", name: "VS Code / Copilot", kind: "json", docs: "https://code.visualstudio.com/docs/agent-customization/mcp-servers", steps: ["افتح Command Palette في VS Code، وشغّل MCP: Add Server ثم اختر HTTP.", "الصق عنوان الخادم وسمّه sellerctrl، أو ادمج إعداد JSON التالي في ملف .vscode/mcp.json.", "ابدأ الخادم من MCP: List Servers، وأكمل OAuth عند طلبه، ثم فعّل أدواته في وضع Agent."] },
] as const;
export type McpClientGuideId = typeof MCP_CLIENT_GUIDES[number]["id"];

export function clientSetup(id: McpClientGuideId, endpoint: string): { format: string; content: string; filename?: string; reauth?: string } {
  const quoted = `'${endpoint.replaceAll("'", "''")}'`;
  switch (id) {
    case "codex": return { format: "Terminal", content: `codex mcp add sellerctrl --url ${quoted}`, reauth: "codex mcp login sellerctrl --oauth-client-registration dcr --scopes erp.identity,inventory.read,purchases.read,sales.read,accounting.read,marketplace.read" };
    case "claude-code": return { format: "Terminal", content: `claude mcp add --transport http --scope user sellerctrl ${quoted}` };
    case "gemini-cli": return { format: "Terminal", content: `gemini mcp add --transport http sellerctrl ${quoted}` };
    case "cursor": return { format: ".cursor/mcp.json", content: JSON.stringify({ mcpServers: { sellerctrl: { url: endpoint } } }, null, 2), filename: "sellerctrl-cursor.json" };
    case "vscode": return { format: ".vscode/mcp.json", content: JSON.stringify({ servers: { sellerctrl: { type: "http", url: endpoint } } }, null, 2), filename: "sellerctrl-vscode.json" };
    default: return { format: "OAuth · Streamable HTTP · DCR", content: endpoint };
  }
}
