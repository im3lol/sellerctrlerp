# تقرير المراجعة الشاملة لمنظومة Control ERP وSellerCtrl

**تاريخ المراجعة:** 20 يونيو 2026  
**الهدف:** تقييم النظامين بوصفهما أساسًا لمنصة ERP واحدة قوية موجهة للسوق المصري، مع استخدام Odoo وERPNext كمرجع وظيفي ومعماري.  
**نطاق الأدلة:** الكود ومخططات البيانات والمهاجرات وإعدادات التشغيل والاختبارات المحلية. لم تشمل المراجعة بيانات إنتاج أو اختبار اختراق أو اعتمادًا قانونيًا/ضريبيًا.

## الخلاصة التنفيذية

- **المنظومة الحالية ليست جاهزة للإنتاج كنظام ERP مالي موحد.** يوجد تطبيقان بقاعدتي بيانات وORM مختلفين ومنطق أعمال متكرر. كلاهما يحتوي نواة ERP مفيدة، لكن تشغيلهما معًا سيؤدي حتمًا إلى اختلاف الأرصدة، أرقام المستندات، وحالة المستند الواحد.
- **القرار المعماري الموصى به هو اعتماد `sellerctrlops` كمنصة مستهدفة واحدة، وليس لأنه مكتمل، بل لأنه يحتوي بالفعل على دمج ERP داخل تطبيق العمليات، تنظيم صفحات أفضل، صلاحيات على مستوى المؤسسة، سجل تدقيق عام، ومهاجرات Drizzle قابلة للتتبع.** يجب نقل الميزات الأقوى من Control ERP إليه، ثم إيقاف التطبيق الجذري بعد اجتياز اختبارات المطابقة.
- **توجد مخاطر سلامة مالية حرجة يجب علاجها قبل أي ترحيل إنتاجي.** أخطرها أن تأكيد فاتورة البيع في Control ERP يغيّر المخزون وطبقات FIFO خارج معاملة واحدة ثم يرحّل القيد في معاملة لاحقة؛ كما أن SellerCtrl يرفع رصيد العميل أو المورد عند إنشاء مسودة فاتورة، قبل الترحيل.
- **CRM والموارد البشرية ليسا موديولين ERP مكتملين.** SellerCtrl يملك Workspaces ومنتجات عملاء ومهام وحضورًا، لكنه لا يملك دورة Lead → Opportunity → Quotation → Sales Order، ولا ملف موظف وعقد وإجازات ورواتب وتأمينات. Control ERP لا يملك أي تنفيذ لهذين الموديولين.
- **الامتثال المصري في مرحلة بيانات أولية فقط.** يوجد رقم ضريبي ونسبة VAT افتراضية في Control ERP، لكن لا يوجد تكامل ETA، توقيع إلكتروني، UUID، أكواد GS1/EGS، متابعة قبول/رفض، إشعارات دائن/مدين إلكترونية، أو منظومة إيصال إلكتروني.

**القرار المقترح:** تجميد إضافة وظائف ERP جديدة إلى Control ERP، إصلاح مخاطر P0 في SellerCtrl، توحيد مصدر الحقيقة على PostgreSQL + Drizzle، ثم ترحيل البيانات والوظائف تدريجيًا مع تشغيل اختبارات مطابقة مالية ومخزنية قبل إيقاف النظام القديم.

## منهج التقييم وحدوده

استخدم التقييم مقياس نضج من خمس درجات:

| الدرجة | المعنى |
|---:|---|
| 0 | غير موجود |
| 1 | واجهة أو جداول أولية بلا دورة مكتملة |
| 2 | دورة جزئية أو معزولة عن بقية النظام |
| 3 | نواة عملية جيدة مع فجوات تمنع الإنتاج القوي |
| 4 | جاهز للإنتاج مع ضوابط واختبارات كافية |
| 5 | تغطية مرجعية قريبة من Odoo/ERPNext وقابلة للتوسع |

الدرجات التالية **تقدير هندسي ordinal وليست قياسًا إحصائيًا**؛ لذلك استخدمت الجداول بدل الرسوم البيانية. لا توجد بيانات استخدام أو إنتاج تسمح برسم مؤشرات كمية ذات معنى.

## صورة المستودع الحالية

| البند | Control ERP (الجذر) | SellerCtrl (`sellerctrlops`) |
|---|---|---|
| التقنية | Next.js 16، React 19، Prisma، PostgreSQL | Next.js 16، React 19، Drizzle، PostgreSQL |
| حجم الكود المراجع | 209 ملفات TS/TSX/Prisma، قرابة 58.8k سطر | 296 ملف TS/TSX ضمن app/components/lib/db، قرابة 24.5k سطر |
| واجهة الخادم | 79 Route Handlers؛ 75 تستخدم حارس مصادقة/صلاحية صريحًا | Server Components + Server Actions + عدد محدود من API routes |
| نموذج تعدد الكيانات | `Company` و`CompanyUser` | `Organization` و`OrganizationMember` |
| مخطط ERP | 45 نموذج Prisma تقريبًا | 46 جدول ERP في `db/erp.ts` إضافة إلى جداول التشغيل |
| الاختبارات | لا توجد حزمة اختبارات فعلية | ملف واحد: 9 اختبارات RBAC فقط |
| حالة Git | التطبيق الأساسي متتبع | المجلد كاملًا غير متتبع في مستودع الأب |

**دلالة ذلك:** SellerCtrl ليس إضافة صغيرة؛ هو إعادة تنفيذ/ترحيل فعلية لنفس ERP داخل منتج آخر. التعليق في [مخطط SellerCtrl](sellerctrlops/db/schema.ts#L544) يصرح بأن جداول ERP نُقلت من مخطط Prisma القديم، كما أن [نموذج صلاحيات ERP](sellerctrlops/lib/erp/permissions.ts#L1) يصرح بأنه منقول من النظام القديم. استمرار التطوير في التطبيقين يعني صيانة نسختين من قواعد العمل نفسها.

## مصفوفة نضج الموديولات

| الموديول | Control ERP | SellerCtrl | الحكم |
|---|---:|---:|---|
| الحسابات العامة | 3.2/5 | 3.0/5 | الجذر أعمق في الضبط المركزي والفترات والتسلسل؛ SellerCtrl أنظف في المعاملات الحديثة لكنه يسمح بترحيل دون فترة/دفتر إلزامي |
| المشتريات | 3.0/5 | 3.3/5 | SellerCtrl يملك PO → GRN → Invoice وGRNI، لكن يحتاج كميات جزئية ومطابقة ثلاثية وضبط الترقيم |
| المخزون | 3.0/5 | 3.2/5 | الجذر يخلط FIFO ومتوسط التكلفة ومسارات متعددة؛ SellerCtrl وحّد الحركة على WAC لكنه يفتقد الحجز والدفعات/السيريال |
| المبيعات | 2.8/5 | 3.2/5 | SellerCtrl يملك Order → Delivery → Invoice، لكن البيع المباشر واختيار أول مخزن يحتاجان ضبطًا |
| CRM | 0/5 | 1.7/5 | Workspaces والمهام ليست CRM مبيعات؛ لا Leads أو Opportunities أو Pipeline أو Activities مرتبطة بعروض الأسعار |
| المستثمرون | 3.0/5 | 1.0/5 | الجذر يملك استثمارات وتوزيعات وسحوبات ودفتر مستثمر؛ SellerCtrl يملك CRUD للمستثمر فقط رغم وجود الجداول |
| الموارد البشرية | 0/5 | 1.5/5 | SellerCtrl يملك مستخدمين وحضورًا وأداءً، ولا يملك HR/Payroll مكتملًا |
| التقارير | 3.0/5 | 2.5/5 | كلاهما يقدم ميزان مراجعة وقوائم أساسية؛ لا توجد اختبارات مصالحة أو إقفال سنوي كامل |
| الصلاحيات وتعدد الشركات | 3.0/5 | 3.2/5 | SellerCtrl أوضح في org-scoped permissions، لكن التكامل بين RBAC العام وERP مزدوج ومعقد |
| التدقيق والتشغيل | 1.5/5 | 2.5/5 | SellerCtrl يملك Audit Log عام، لكنه لا يغطي معظم حركات ERP؛ CI والتغطية الاختبارية غير كافيين |

## النتائج الحرجة ذات الأولوية P0

### 1. تأكيد فاتورة البيع في Control ERP غير ذري ويمكن أن يفصل المخزون عن الحسابات

يبدأ المسار بمعاملة قصيرة للتحقق من الإعداد والفترة فقط في [فاتورة البيع](src/app/api/sales/invoices/%5Bid%5D/route.ts#L132)، ثم ينفذ استهلاك FIFO، إنشاء حركات المخزون، تحديث الأرصدة، وتحديث تكلفة السطور باستخدام عميل `db` خارج المعاملة في [الأسطر 151-355](src/app/api/sales/invoices/%5Bid%5D/route.ts#L151). بعد ذلك فقط ينشئ القيد في معاملة جديدة في [السطر 440](src/app/api/sales/invoices/%5Bid%5D/route.ts#L440)، ثم يعدل رصيد العميل وحالة الفاتورة خارجها في [السطر 517](src/app/api/sales/invoices/%5Bid%5D/route.ts#L517).

**الأثر:** فشل القيد أو تحديث العميل بعد خصم المخزون يترك دفتر المخزون مختلفًا عن الأستاذ العام. كما أن طلبين متزامنين يستطيعان المرور من فحص الحالة قبل أن يغيّر أحدهما الفاتورة.

**معيار القبول:** تأكيد الفاتورة عملية واحدة داخل transaction قابلة للتكرار بأمان؛ إما أن تُحفظ حركة المخزون والقيد ورصيد العميل والحالة كلها، أو لا يُحفظ شيء. اختبار fault injection بعد كل خطوة يجب أن يثبت rollback كاملًا.

### 2. إلغاء فاتورة البيع في Control ERP يعكس أجزاء الدورة خارج معاملة واحدة

الإلغاء يعيد المخزون وطبقات FIFO أولًا في [الأسطر 565-650](src/app/api/sales/invoices/%5Bid%5D/route.ts#L565)، ثم يعكس القيد في معاملة منفصلة في [السطر 653](src/app/api/sales/invoices/%5Bid%5D/route.ts#L653)، ثم يعدل رصيد العميل والحالة لاحقًا. أي فشل وسيط ينتج نصف إلغاء.

**معيار القبول:** قيد عكسي واحد، حركات مخزون عكسية، رصيد طرف، وحالة مستند ضمن معاملة واحدة؛ مع مفتاح idempotency يمنع تكرار الإلغاء.

### 3. SellerCtrl يحمّل أرصدة العملاء والموردين عند إنشاء المسودة

إنشاء فاتورة بيع DRAFT يزيد رصيد العميل داخل المعاملة في [sales-invoices.ts:108](sellerctrlops/app/actions/erp/sales-invoices.ts#L108)، وإنشاء فاتورة شراء DRAFT يزيد رصيد المورد في [purchase-invoices.ts:81](sellerctrlops/app/actions/erp/purchase-invoices.ts#L81). القيد العام لا يُرحّل إلا لاحقًا.

**الأثر:** شاشة بطاقة العميل/المورد لا تتطابق مع الأستاذ العام، والمسودات غير المعتمدة تؤثر في الرصيد التشغيلي. هذا يخالف مبدأ أن المستند غير المرحّل لا ينشئ ذمة.

**معيار القبول:** تحديث subledger والطرف يتم عند POSTED فقط وفي نفس معاملة القيد. إلغاء/عكس المستند يضيف حركة عكسية ولا يعيد كتابة الرصيد بصورة عمياء.

### 4. الترقيم في SellerCtrl معرض للتصادم تحت التزامن

توليد أرقام القيود والحركات والفواتير يقرأ آخر رقم ثم يضيف واحدًا، مثل [posting.ts:29](sellerctrlops/lib/erp/posting.ts#L29)، [inventory.ts:38](sellerctrlops/lib/erp/inventory.ts#L38)، و[sales-invoices.ts:31](sellerctrlops/app/actions/erp/sales-invoices.ts#L31). الفهرس الفريد يمنع التكرار لكنه لا يمنع فشل إحدى العمليتين.

Control ERP يملك `DocumentSequence` وقيمة تزداد ذريًا في [accounting-engine.ts:171](src/lib/accounting-engine.ts#L171)، وهو النمط الذي يجب نقله.

**معيار القبول:** sequence ذري لكل مؤسسة/نوع/سنة، مع اختبار 50 طلبًا متزامنًا يثبت التفرد والاستمرارية وعدم فشل المعاملات بسبب الرقم.

### 5. استخدام `Float` للأموال في Control ERP

مبالغ الفواتير والقيود والأرصدة معرفة كـ`Float` في [مخطط Prisma](prisma/schema.prisma#L609)، بينما SellerCtrl يستخدم أعمدة numeric وقيمًا نصية في طبقة Drizzle. التقريب إلى سنت داخل بعض الدوال لا يمنع تراكم أخطاء binary floating point في كل المسارات والتقارير.

**معيار القبول:** جميع العملات `numeric/decimal` بدقة موحدة، والكميات بدقة مستقلة، ولا تُستخدم أعداد JavaScript العائمة للحساب النهائي دون طبقة Money/Decimal واختبارات rounding.

### 6. لا توجد شبكة أمان اختبارية لدورات ERP

Control ERP بلا test runner أو اختبارات نطاق. SellerCtrl نجح في 9 اختبارات لكنها تختبر RBAC فقط، ولا تختبر قيدًا أو فاتورة أو مخزونًا. هذه فجوة P0 لأن الكود يتعامل مع أرصدة مالية دائمة.

**معيار القبول:** اختبارات تكامل بقاعدة PostgreSQL حقيقية لكل دورة P0، وفحوص invariants بعد كل سيناريو: مجموع المدين = الدائن، رصيد المخزون = مجموع ledger، GL inventory = stock valuation، ورصيد الطرف = مجموع المستندات المفتوحة.

## مراجعة الدورات المتكاملة

## دورة Lead-to-Cash

### الوضع المرجعي

الدورة القوية وفق نمط Odoo/ERPNext تبدأ من Lead/Opportunity، ثم نشاط ومتابعة، عرض سعر، أمر بيع، حجز/تسليم، فاتورة، تحصيل، مرتجع/إشعار دائن، ثم تقارير الذمم والإيراد.

### Control ERP

الموجود يبدأ من Customer ثم Sales Order/Invoice/Delivery/Pick List/Receipt/Return. لا توجد مرحلة Lead أو Opportunity أو Quotation. توجد روابط اختيارية بين أوامر البيع وأذون التسليم والفواتير والمرتجعات في [schema.prisma](prisma/schema.prisma#L693)، لكن سلامة الدورة تعتمد على كل Route Handler بصورة منفصلة.

أهم الفجوات:

- لا pipeline أو احتمالية إغلاق أو مصدر lead أو owner أو activity plan.
- لا عرض سعر منفصل بإصدارات وموافقة وتحويل إلى أمر بيع.
- دعم التسليم الجزئي والفوترة الجزئية غير واضح؛ مجرد وجود أي Delivery Note مؤكدة يجعل فاتورة البيع تتجاوز معالجة المخزون بالكامل في [فاتورة البيع:170](src/app/api/sales/invoices/%5Bid%5D/route.ts#L170).
- فحص التوفر يجمع الرصيد لكل المخازن ثم يستهلك FIFO عبر المخازن دون اختيار مخزن صريح في الفاتورة.

### SellerCtrl

يقدم مسارًا أوضح: أمر بيع مؤكد → تسليم كامل → قيد COGS ومخزون → تحويل التسليم إلى فاتورة POSTED للإيراد والذمم. التنفيذ ظاهر في [deliveries.ts:26](sellerctrlops/app/actions/erp/deliveries.ts#L26) و[deliveries.ts:84](sellerctrlops/app/actions/erp/deliveries.ts#L84).

لكن:

- ما يسمى CRM في القائمة هو Workspaces ومنتجات عملاء ومهام؛ المخطط لا يملك Lead/Opportunity/Quotation.
- التسليم كامل فقط، ويختار أول مخزن نشط مرتبًا بالكود في [deliveries.ts:41](sellerctrlops/app/actions/erp/deliveries.ts#L41)، وليس مخزن الأمر أو خطة fulfillment.
- يوجد مسار فاتورة بيع مباشرة يصرف من أول مخزن أيضًا في [sales-invoices.ts:170](sellerctrlops/app/actions/erp/sales-invoices.ts#L170). يجب تعريف policy واضحة: invoice-driven أو delivery-driven، مع منع الازدواج.
- لا حجز مخزون، backorder، partial delivery، أو إلغاء/إرجاع للتسليم نفسه.

**التصميم المستهدف:** Lead → Opportunity → Quotation(versioned) → Sales Order → Reservation → Delivery/Backorder → Invoice schedule → Receipt/Allocation → Credit Note/Return. كل انتقال ينشأ من المستند السابق ويحتفظ `sourceDocumentId` وكميات ordered/delivered/invoiced/returned.

## دورة Procure-to-Pay

### Control ERP

يملك Supplier وMaterial Request وPurchase Order وPurchase Receipt وPurchase Invoice وPayment وPurchase Return. فاتورة الشراء تُرحّل المخزون والقيد ورصيد المورد داخل transaction واحدة في [purchase invoice:120](src/app/api/purchases/invoices/%5Bid%5D/route.ts#L120)، وهو أفضل من مسار البيع.

الفجوات:

- لا RFQ أو مقارنة عروض موردين أو approval matrix.
- لا طلب شراء يتحول رسميًا إلى RFQ/PO مع trace كامل.
- وجود أي إيصال شراء مرتبط يجعل الفاتورة تتجاوز المخزون كله، بلا مطابقة كميات جزئية.
- لا three-way matching بين PO وReceipt وInvoice ولا tolerances للسعر/الكمية.
- الإلغاء يفترض إمكانية إخراج كامل كمية الفاتورة حتى لو بيع جزء منها لاحقًا؛ يجب أن يمنع الإلغاء أو يستخدم مرتجع شراء بكمية متاحة.

### SellerCtrl

المسار الأقوى هو PO مؤكد → GRN كامل، حيث يدخل المخزون ويُرحل Dr Inventory / Cr GRNI في [goods-receipts.ts:26](sellerctrlops/app/actions/erp/goods-receipts.ts#L26)، ثم GRN → Invoice يصفّي GRNI إلى AP دون لمس المخزون في [goods-receipts.ts:85](sellerctrlops/app/actions/erp/goods-receipts.ts#L85). هذا قريب من التصميم المرجعي الصحيح.

الفجوات:

- الاستلام والفوترة كاملان فقط؛ لا partial receipt أو partial billing.
- لا quantity/price tolerance ولا حالة exception للمطابقة الثلاثية.
- يوجد أيضًا مسار فاتورة شراء مباشرة يدخل المخزون في [purchase-invoices.ts:133](sellerctrlops/app/actions/erp/purchase-invoices.ts#L133). يجب تمييز Direct Purchase بوضوح أو منع استخدامه مع PO/GRN.
- الحسابات مثل 1104/2101/2103 hard-coded بدل إعداد posting profiles حسب الشركة/الصنف/الضريبة.

**التصميم المستهدف:** Requisition → RFQ → Supplier Quotation → Approved PO → Partial GRN → Quality/Acceptance → Supplier Invoice → Three-way Match → Payment Proposal → Payment/Reconciliation → Debit Note/Return.

## دورة Stock-to-GL

### Control ERP

النظام يحتفظ بثلاثة تمثيلات متوازية: `StockMovement` و`ItemBalance` و`FifoLayer`. هذا يسمح بـFIFO، لكنه يزيد احتمال الانحراف لأن مسارات متعددة تكتب الجداول مباشرة. فاتورة البيع تستهلك FIFO، بينما بعض الأذون والتحويلات تستخدم `avgCost`. النتيجة أن سياسة valuation ليست واحدة.

نقاط جيدة:

- منع رصيد غير كافٍ في عدة مسارات.
- طبقات FIFO، تحويلات، أذون استلام وصرف، قوائم تحضير، وطلبات مواد.
- ربط حركة المخزون بالمستند المرجعي.

مخاطر:

- لا constraint قاعدة بيانات يمنع `ItemBalance.quantity < 0`.
- التحقق ثم التحديث غير مقفول row-level في بعض المسارات، لذلك السباق قد يصنع مخزونًا سالبًا.
- إعادة بناء الرصيد من ledger ومقارنته بـItemBalance غير متوفرة كوظيفة مصالحة.
- إلغاء الفاتورة يعيد طبقة FIFO جديدة بدل استعادة هوية الطبقات الأصلية، ما يغير ترتيب التكلفة التاريخي.

### SellerCtrl

الدالة [postStockMovement](sellerctrlops/lib/erp/inventory.ts#L71) هي نقطة كتابة موحدة لدفتر دائم بتكلفة متوسط مرجح، وتمنع الصرف السالب افتراضيًا. هذا أساس أفضل من حيث البساطة.

لكن:

- الرصيد السابق يُقرأ من آخر حركة وفق `createdAt/id`، ثم يُكتب رقم جديد بأسلوب read-then-write دون قفل؛ عمليتان متزامنتان قد تبنيان على الرصيد نفسه.
- مخطط ERP ما زال يحتوي `itemBalances` و`fifoLayers` الموروثين في [db/erp.ts:199](sellerctrlops/db/erp.ts#L199)، رغم أن المنطق الجديد يعتمد ledger/WAC. يجب حذف/ترحيل الكيانات غير المستخدمة لمنع مصدر حقيقة ثانٍ.
- لا lots/serials، expiry، inventory reservation، landed cost، cycle count، أو stock reconciliation رسمي.

**التصميم المستهدف:** دفتر حركة append-only هو مصدر الحقيقة، مع locking على `(organization,item,warehouse)`, وجدول balance مشتق/محدّث ذريًا، وسياسة valuation واحدة قابلة للتهيئة، ومهمة reconciliation يومية بين الكمية والقيمة وGL.

## الحسابات والرقابة المالية

### نقاط القوة في Control ERP

- تحقق القيد بالسنت ومنع القيد غير المتوازن في [accounting-engine.ts:21](src/lib/accounting-engine.ts#L21).
- فترات OPEN/SOFT_CLOSED/CLOSED والتحقق منها في [accounting-engine.ts:101](src/lib/accounting-engine.ts#L101).
- إعداد مركزي لحسابات AR/AP/Tax/Inventory/COGS ودفاتر البيع والشراء والنقدية في [automatic-posting.ts](src/lib/automatic-posting.ts#L1).
- مفتاح فريد `(companyId, sourceType, sourceId)` يمنع القيد الآلي المكرر في [schema.prisma:639](prisma/schema.prisma#L639).
- عكس القيود بدل تعديل القيد المرحل في [automatic-posting.ts:186](src/lib/automatic-posting.ts#L186).

### نقاط الضعف في Control ERP

- بعض المسارات الجديدة تستخدم المحرك المركزي، بينما مسارات قديمة لا تزال تبني قيودًا وأرقامًا يدويًا ثم أصبحت أجزاء منها dead code، كما يظهر في [فاتورة البيع:357-515](src/app/api/sales/invoices/%5Bid%5D/route.ts#L357). هذا دليل انتقال غير مكتمل.
- حذف الشركة القسري يحذف القيود والمستندات والحركات فعليًا في [force-delete route](src/app/api/companies/%5Bid%5D/force-delete/route.ts#L32). نظام مالي إنتاجي يجب أن يمنع حذف سجل محاسبي مرحل أو يستخدم anonymization/retention policy واعتمادًا متعدد الأطراف.
- لا bank reconciliation، cash management مكتمل، fixed assets، budgets، recurring entries، accruals، exchange gains/losses، أو year-end close.
- لا Audit Log عام لحركات ERP.

### نقاط القوة في SellerCtrl

- القيد والحركة والمستند ينفذون غالبًا داخل Drizzle transaction واحدة.
- القيود المرحلة تُعكس ولا تُحذف في [posting.ts:173](sellerctrlops/lib/erp/posting.ts#L173).
- دليل حسابات، مراكز تكلفة، فترات، يوميات، ميزان مراجعة، قائمة دخل وميزانية.
- دورة GRNI وفصل التسليم عن الفوترة أقرب للممارسات المرجعية.

### نقاط الضعف في SellerCtrl

- `postEntry` يسمح بعدم وجود فترة مالية ويخزن `null`، ويسمح بعدم وجود دفتر نشط ويخزن `journalId=null` في [posting.ts:63-96](sellerctrlops/lib/erp/posting.ts#L63). Control ERP أكثر صرامة هنا.
- لا يتحقق `postEntry` من أن الحسابات تفصيلية ونشطة وتتبع المؤسسة؛ يعتمد على صحة المستدعي.
- رقم JV لا يستخدم `documentSequences` الموجود أصلًا في المخطط.
- ERP actions لا تسجل before/after في Audit Log العام. السجل الحالي يُستخدم أساسًا للمستخدمين والمنتجات، راجع [activity.ts:46](sellerctrlops/lib/activity.ts#L46).
- إعدادات الترحيل تعتمد أكواد حسابات hard-coded بدل `accountingConfigurations` الموجود في [db/erp.ts:488](sellerctrlops/db/erp.ts#L488).

**قرار الدمج:** نقل صرامة محرك Control ERP إلى SellerCtrl: فترة ودفتر إلزاميان، posting configuration، atomic sequence، تحقق الحسابات والأبعاد، ومفتاح idempotency. الإبقاء على معاملات Drizzle الموحدة ونموذج WAC/GRNI في SellerCtrl.

## CRM: الموجود ليس CRM مبيعات كاملًا

SellerCtrl يسمي مجموعة Workspaces/Products/Tasks موديول CRM في [nav-config.ts](sellerctrlops/components/app-shell/nav-config.ts#L72). هذه وظائف إدارة عمليات وخدمة عميل، وليست دورة إدارة فرص.

المفقود:

- Lead وContact وAccount منفصلة مع deduplication.
- Opportunity stages، probability، expected revenue، close date، loss reasons.
- Activity stream: مكالمة/اجتماع/بريد/مهمة مرتبطة بالفرصة.
- Territory، sales team، owner، campaign/source، lead scoring.
- Quotation بإصدارات وموافقة وتحويل مباشر إلى Sales Order.
- Forecast وpipeline reports وconversion rate.
- ربط العميل التجاري في CRM بـCustomer المحاسبي دون ازدواج.

**مصدر الحقيقة المقترح:** Party/Organization موحد، Contact متعدد، ثم Customer Account محاسبي اختياري. تتحول Opportunity إلى Quotation، والQuotation المقبول إلى Sales Order؛ لا يُنسخ العميل يدويًا بين الموديولين.

## الموارد البشرية: حضور ومستخدمون فقط

SellerCtrl يملك `users` و`attendance` وإدارة أداء/مهام وأكاديمية، وهي بداية جيدة للتجربة الداخلية. لكنها لا تغطي Hire-to-Retire.

المفقود:

- Employee master مستقل عن حساب الدخول، ورقم موظف، جهة عمل، فرع، قسم، وظيفة، مدير.
- Recruitment، offer، onboarding/offboarding، documents.
- Contracts، shifts، calendars، overtime، holidays.
- Leave types، accrual، requests، approvals، balances.
- Payroll structure، earnings/deductions، loans، expenses، payslips، payroll journal.
- متطلبات مصر: التأمينات، ضريبة كسب العمل، الشرائح والإعفاءات السارية، ملفات الرواتب، وسياسات قانون العمل.

**التصميم المستهدف:** `User` للهوية والدخول فقط، و`Employee` للسجل الوظيفي. يرتبط الموظف بمؤسسة وعقد وتقويم ودوام وإجازات، ويولد Payroll Run قيودًا محاسبية قابلة للعكس. قواعد مصر يجب أن تكون versioned effective-dated لا أرقامًا ثابتة داخل الكود.

## المستثمرون

Control ERP يملك `Investor`, `Investment`, `ProfitDistribution`, `InvestorShare`, و`Withdrawal` في [schema.prisma:968](prisma/schema.prisma#L968)، وواجهات للاستثمارات والتوزيعات والسحوبات ودفتر المستثمر. كما ينشئ حسابات فرعية للمستثمرين وقيود توزيع.

لكن بعض مسارات المستثمرين لا تستخدم المحرك المحاسبي المركزي والفترة/التسلسل الذري بصورة موحدة؛ لذلك يلزم إدخالها تحت نفس Posting Service.

SellerCtrl نقل الجداول إلى [db/erp.ts:827](sellerctrlops/db/erp.ts#L827)، لكن واجهة/action المستثمر الحالية لا تفعل سوى إنشاء/تعديل/حذف بيانات المستثمر في [investors.ts](sellerctrlops/app/actions/erp/investors.ts#L21). لا توجد دورة استثمار أو توزيع أو دفع ظاهرة في المنتج.

**قرار الدمج:** نقل دورة المستثمر الكاملة من الجذر، مع تعريف واضح لحقوق الملكية مقابل قرض شريك، effective ownership، منع تجاوز مجموع الملكية 100% في التاريخ نفسه، واعتماد التوزيع وقيده ودفعه وعكسه.

## الصلاحيات وتعدد الشركات

### Control ERP

الإيجابي أن 75 من 79 Route Handlers تستخدم حارسًا صريحًا؛ الأربعة الأخرى هي root API وNextAuth وlogin وseed. Endpoint البذر محمي بـ`SEED_SECRET` ومغلق في الإنتاج ما لم يُسمح به صراحة في [seed route:5](src/app/api/seed/route.ts#L5).

المخاطر:

- صلاحيات ثابتة حسب الدور ولا توجد موافقات أو segregation of duties على مستوى مبلغ/فرع.
- مفاتيح FK للأصناف والمخازن والحسابات ليست composite مع `companyId`؛ سلامة tenant تعتمد على كل query.
- Access Tokens مخزنة كقيم قابلة للبحث مباشرة، ويجب تخزين hash فقط مع تدوير وإلغاء ومعلومات آخر استخدام.
- حذف الشركة القسري يحتاج approval وretention وتدقيقًا غير قابل للتغيير.

### SellerCtrl

يستخدم طبقتين: RBAC عام في [lib/rbac.ts](sellerctrlops/lib/rbac.ts#L1)، ثم ERP role داخل `organization_members` في [erp permissions](sellerctrlops/lib/erp/permissions.ts#L42). الفصل جيد، لكن وجود role عام وrole ERP قد ينتج قرارات متعارضة ويصعب تدقيقه.

المخاطر:

- روابط FK في `db/erp.ts` لا تضمن أن item وwarehouse وaccount يتبعون organization نفسها؛ التحقق تطبيقي.
- `system_admin` يتجاوز كل المؤسسات؛ يلزم step-up authentication وسجل وصول ودور break-glass.
- Audit Log العام لا يغطي كل Server Actions المالية.
- مجلد SellerCtrl غير متتبع حاليًا، فلا توجد حماية review/history حقيقية لهذه النسخة.

**التصميم المستهدف:** Permission service واحد يدعم role + capability + organization scope + approval limits، مع سياسات SoD مثل منع منشئ القيد من اعتماده فوق حد معين، وإلزام `organization_id` في كل repository وخدمة.

## الامتثال المصري

المراجعة هنا gap analysis تقنية وليست رأيًا قانونيًا. يجب اعتماد المتطلبات النهائية مع محاسب قانوني ومستشار ضرائب/عمل قبل الإنتاج.

### الموجود

- Control ERP يخزن `taxNumber` و`vatRate` افتراضيًا 14% في [Company](prisma/schema.prisma#L45).
- الفواتير تحمل tax amount، وتوجد حسابات input/output tax وقيود لها.

### المفقود للفواتير والإيصالات الإلكترونية

- بيانات التسجيل الضريبي والفروع والعناوين المنظمة وفق ETA.
- أنواع المستندات والإصدارات، internal ID وUUID، issuer/receiver، payment/delivery details.
- أكواد أصناف GS1/EGS ومزامنتها وحالة قبولها.
- canonical JSON، التوقيع الإلكتروني، إدارة الشهادات/HSM أو token، submission API.
- lifecycle للحالات: pending/valid/invalid/rejected/cancelled، retries وidempotency، polling/webhooks.
- credit/debit notes مرتبطة بمرجع ETA الأصلي.
- أرشيف payload/response غير قابل للتعديل وسياسة احتفاظ.
- eReceipt لتعاملات B2C ونقاط البيع والأجهزة/الفروع عند انطباقه.

المرجع التقني الرسمي الواجب البناء عليه هو [Egyptian Tax Authority eInvoicing SDK](https://sdk.invoicing.eta.gov.eg/) وصفحات [Document Types](https://sdk.invoicing.eta.gov.eg/documents/) و[Codes](https://sdk.invoicing.eta.gov.eg/codes/). وجود ضريبة 14% وحده لا يعني امتثالًا.

### الرواتب والعمل

لا يوجد محرك رواتب حاليًا. يجب تصميم القواعد الفعلية بعد تثبيت النسخ السارية من قانون العمل والضرائب والتأمينات من الجهات المصرية، مع effective dates وإعادة حساب retroactive. المصادر الرسمية التي ينبغي اعتمادها أثناء التنفيذ تشمل [وزارة العمل المصرية](https://www.manpower.gov.eg/) و[الهيئة القومية للتأمين الاجتماعي](https://www.nosi.gov.eg/).

## المقارنة مع Odoo وERPNext

استخدمت المقارنة كـcapability benchmark، لا كطلب نسخ حرفي للواجهات.

| المجال المرجعي | المطلوب في منصة قوية | الوضع الحالي |
|---|---|---|
| Accounting | journals، periods، reconciliation، taxes، assets، budgets، multi-currency، immutable posting | نواة GL جيدة؛ المصالحة والبنوك والأصول والعملات المتعددة التشغيلية ناقصة |
| Selling | CRM/quotation/order/delivery/invoice/payment/returns | يبدأ النظام من Customer/Order؛ CRM وQuotation ناقصان، والجزئيات ضعيفة |
| Buying | requisition/RFQ/PO/receipt/invoice/matching/payment/return | SellerCtrl قريب من PO/GRN/GRNI/Invoice، لكن RFQ والمطابقة والجزئيات ناقصة |
| Stock | locations، reservations، lots/serials، valuation، replenishment، landed costs | مستودعات وحركات وإعادة طلب؛ لا reservation/lots/landed cost ومصالحة valuation محدودة |
| HR | employee lifecycle، leave، attendance، payroll، recruitment، expenses | حضور ومستخدمون فقط |
| CRM | leads، opportunities، activities، forecasts، conversion | غير موجود فعليًا |
| Governance | workflows، approvals، audit، role segregation، automation | صلاحيات جيدة كبداية؛ approvals وSoD وERP audit ناقصة |

المراجع الرسمية: [Odoo Accounting](https://www.odoo.com/documentation/19.0/applications/finance/accounting.html)، [Inventory](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory.html)، [Purchase](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase.html)، [Sales](https://www.odoo.com/documentation/19.0/applications/sales/sales.html)، [CRM](https://www.odoo.com/documentation/19.0/applications/sales/crm.html)، [HR](https://www.odoo.com/documentation/19.0/applications/hr.html)، وERPNext [Accounting](https://docs.frappe.io/erpnext/user/manual/en/accounting)، [Selling](https://docs.frappe.io/erpnext/user/manual/en/selling)، [Buying](https://docs.frappe.io/erpnext/user/manual/en/buying)، [Stock](https://docs.frappe.io/erpnext/user/manual/en/stock)، [Human Resources](https://docs.frappe.io/erpnext/user/manual/en/human-resources).

## معمارية الدمج المقترحة

### القرار

اعتماد SellerCtrl كـmodular monolith واحد على PostgreSQL وDrizzle، مع وحدات نطاق واضحة داخل التطبيق، وعدم إنشاء microservices في هذه المرحلة. فصل الخدمات يأتي فقط عند وجود حاجة تشغيلية مثبتة.

### حدود الوحدات

1. **Identity & Organization:** المستخدمون، المؤسسات، العضويات، الأدوار.
2. **Party & CRM:** الأطراف، جهات الاتصال، leads، opportunities، activities، quotations.
3. **Sales:** orders، reservations، deliveries، invoices، receipts، returns.
4. **Procurement:** requisitions، RFQ، PO، GRN، supplier invoices، payments، returns.
5. **Inventory:** item master، warehouses/locations، stock ledger، valuation، replenishment.
6. **Accounting:** COA، journals، periods، posting profiles، GL، tax، reconciliation.
7. **Investors:** ownership، investments، distributions، withdrawals، ledger.
8. **HR:** employees، contracts، attendance، leave، payroll.
9. **Compliance:** ETA documents/codes/submission/archive، payroll rule versions.
10. **Audit & Workflow:** approvals، audit trail، outbox، document transitions.

### مصادر الحقيقة

| الكيان | مصدر الحقيقة المقترح |
|---|---|
| المستخدم والدخول | SellerCtrl `users` |
| الشركة/المؤسسة | SellerCtrl `organizations` بعد توسيعها ببيانات Control ERP |
| العضوية والصلاحية | `organization_members` مع Permission service موحد |
| العملاء والموردون | Party model موحد مع أدوار Customer/Supplier |
| الأصناف والمخازن | جداول SellerCtrl بعد تنظيف الجداول الموروثة غير المستخدمة |
| المخزون | append-only `stock_movements` + balance ذري مشتق |
| الحسابات والقيود | SellerCtrl Drizzle schema مع نقل ضوابط محرك Control ERP |
| المستندات | SellerCtrl document tables مع source links وكميات تراكمية |
| المستثمرون | جداول SellerCtrl بعد نقل services والدورات من Control ERP |
| الموظفون | Employee جديد مستقل عن User |

### نمط المعاملات

- كل transition يمر عبر Domain Service واحد، لا من الصفحة أو Route مباشرة.
- transaction واحدة تشمل المستند + ledger + GL + subledger + outbox.
- status machine معرفة مركزيًا، والانتقالات غير الصالحة مرفوضة.
- المستند المرحل immutable؛ التصحيح بعكس/credit note/debit note.
- idempotency key لكل أمر ترحيل أو تكامل خارجي.
- document sequence ذري مستقل عن قراءة آخر رقم.
- event outbox داخل نفس transaction للتقارير وETA والإشعارات.

## خطة ترحيل البيانات

1. **تجميد المخططين:** منع إضافة جداول/حقول ERP جديدة خارج مخطط SellerCtrl المستهدف.
2. **قاموس بيانات:** خريطة Company→Organization وCompanyUser→OrganizationMember وكل document/status/account code.
3. **تنظيف العملات والأرقام:** تحويل Float إلى Decimal، وتثبيت precision وسياسة rounding.
4. **توحيد master data:** dedupe للعملاء والموردين والأصناف والأكواد والمخازن، مع legacy IDs دائمة.
5. **ترحيل الإعدادات:** شجرة الحسابات، الفترات، اليوميات، posting configuration، sequences.
6. **ترحيل الافتتاحيات أولًا:** أرصدة GL مفتوحة، open AR/AP، stock lots/value، investor balances.
7. **ترحيل التاريخ:** المستندات والقيود والحركات مع روابط المصدر والحالة الأصلية.
8. **مصالحة آلية:** Trial Balance، AR/AP aging، stock quantity/value، investor ledger لكل شركة وتاريخ قطع.
9. **تشغيل ظلي read-only:** مقارنة تقارير النظامين يوميًا، دون dual-write دائم.
10. **Cutover:** إيقاف الكتابة في Control ERP، delta migration، مصادقة نهائية، ثم archive read-only.

**بوابة النجاح:** صفر فرق في ميزان المراجعة إلى مستوى الحساب والسنت، صفر فرق كمية مخزون إلى مستوى item/warehouse، وفروق القيمة ضمن سياسة rounding موثقة ومعتمدة فقط.

## خارطة الطريق

### P0: سلامة المنصة والمال قبل التوسع

1. إدخال `sellerctrlops` في Git وتحديده كتطبيق canonical، وضبط lint/build لاستبعاد حدود المستودع الصحيحة.
2. منع أي تطوير ERP جديد في التطبيق الجذري عدا إصلاحات سلامة أو أدوات ترحيل.
3. إصلاح أرصدة المسودات في SellerCtrl وترحيل الرصيد إلى event/subledger مشتق من POSTED فقط.
4. نقل atomic DocumentSequence وAccountingConfiguration والتحقق الصارم للفترة/اليومية/الحساب.
5. جعل كل posting/cancel/reverse transaction ذرية وقابلة للتكرار، خصوصًا مسار فاتورة البيع القديم.
6. تثبيت سياسة valuation واحدة وإضافة locking/concurrency control لحركة المخزون.
7. بناء اختبارات التكامل والمصالحة وCI؛ لا merge مع typecheck/lint/test/build فاشل.
8. منع hard delete للمستندات والقيود والشركات ذات التاريخ المالي وإضافة audit لكل ERP mutation.
9. تحويل جميع الأموال من Float إلى Decimal بخطة migration واختبارات rounding.

### P1: اكتمال الدورات الأساسية والدمج

1. partial delivery/receipt/invoice، backorders، reservations، three-way matching.
2. نقل المستثمرين كاملًا إلى SellerCtrl وربطهم بمحرك الترحيل المركزي.
3. Party master موحد ثم CRM أساسي: Lead/Opportunity/Activity/Quotation/Forecast.
4. Employee master والعقود والإجازات وتقويم الدوام وربط الحضور.
5. طبقة ETA: الأكواد، نماذج المستند، التوقيع، الإرسال، الحالات، الأرشفة، credit/debit notes.
6. bank/cash reconciliation، multi-currency فعلي، closing workflow، وموافقات بمبالغ.
7. أدوات ترحيل ومصالحة وتقارير فروق قابلة لإعادة التشغيل.

### P2: قوة المنتج والتوسع

1. Payroll مصري versioned مع قيود محاسبية ومراجعة قانونية.
2. lots/serials/expiry، landed costs، quality، cycle counting.
3. fixed assets، budgets، accruals، expense management، consolidated reporting.
4. eReceipt/POS عند دخول B2C، وتوطين متعدد الدول عبر localization packages.
5. observability: tracing للترحيل، reconciliation alerts، dead-letter/outbox monitoring، وSLOs.

## اختبارات القبول المطلوبة

| السيناريو | النتيجة الإلزامية |
|---|---|
| قيد يدوي | يرفض غير المتوازن/الحساب التجميعي/الفترة المغلقة ويقبل المتوازن مرة واحدة |
| شراء مباشر | Invoice POSTED يزيد المخزون والقيمة وAP ويولد قيدًا متوازنًا ذريًا |
| PO→GRN→Invoice | GRN يزيد المخزون وGRNI؛ Invoice يصفي GRNI إلى AP دون حركة مخزون ثانية |
| بيع مباشر | يتحقق/يقفل الرصيد، يصرف stock، يرحل COGS والإيراد/الضريبة وAR ذريًا |
| SO→Delivery→Invoice | Delivery يصرف المخزون وCOGS؛ Invoice يرحل revenue/AR فقط |
| تسليم/استلام جزئي | cumulative quantities لا تتجاوز الأصل، وتُنشأ backorder صحيحة |
| تحصيل/دفع جزئي | allocations تساوي السند، والحالة تنتقل PARTIAL ثم PAID، ولا يوجد over-allocation |
| مرتجع | لا يتجاوز الكمية المسلمة/المستلمة ناقص المرتجع السابق، ويعكس المخزون والقيد الصحيحين |
| إلغاء/عكس | لا تعديل للقيد الأصلي؛ حركة وقيد عكسيان مرة واحدة، وrollback كامل عند الفشل |
| تزامن | لا أرقام مكررة ولا oversell ولا lost update تحت طلبات متوازية |
| تعدد المؤسسات | لا يمكن استخدام item/account/warehouse/party من مؤسسة أخرى حتى بمعرف صحيح |
| مصالحة | GL inventory = stock valuation، AR/AP control = open items، debits = credits |
| ETA | payload canonical موقّع، retry idempotent، الحالات محفوظة، والرفض قابل للتشخيص |
| Payroll | إجمالي earnings-deductions=net، القيد متوازن، والقواعد مرتبطة بتاريخ سريان |

## نتائج الفحوص المنفذة

| الفحص | Control ERP | SellerCtrl |
|---|---|---|
| TypeScript | نجح باستخدام `node node_modules/typescript/bin/tsc -p tsconfig.check.json --noEmit` خلال 76.5ث | نجح `npm run typecheck` خلال 84.5ث |
| Lint | نجح فحص `src` مع تحذيرين فقط خلال 78.4ث | فشل: 20 error و22 warning؛ منها purity في دفتر الأستاذ وsetState داخل effects |
| Tests | لا يوجد script/حزمة اختبارات ERP | نجح 9/9 في ملف RBAC واحد؛ لا اختبارات ERP |
| Production build | نجح `next build` الأساسي، 60 صفحة، خلال 204.5ث | تجاوز حد 300ث دون نتيجة نهائية |

ملاحظات التشغيل:

- أمر build في الجذر يضيف أوامر Unix `cp` في [package.json:7](package.json#L7)، لذلك تم التحقق من `next build` نفسه فقط على Windows.
- `npm run lint` في الجذر يفحص `eslint .`، ومع وجود SellerCtrl غير متتبع وغير مستبعد تصبح حدود الفحص غير واضحة وبطيئة.
- SellerCtrl typecheck ناجح، لكن lint يفشل في كود ERP نفسه عند حساب الرصيد الجاري أثناء render في [ledger page:141](sellerctrlops/app/%28app%29/erp/accounting/ledger/page.tsx#L141).
- تجاوز build ليس إثبات فشل compilation؛ هو فشل في إكمال بوابة البناء ضمن خمس دقائق ويحتاج profiling/CI بذاكرة وزمن معلنين.

## المخاطر المرتبة

| الأولوية | الخطر | الاحتمال/الأثر | الإجراء |
|---|---|---|---|
| P0 | عدم ذرية فاتورة البيع/الإلغاء في الجذر | مرتفع/حرج | إيقاف المسار أو إعادة كتابته داخل transaction واحدة |
| P0 | أرصدة المسودات في SellerCtrl | مؤكد/عالٍ | نقل تحديث الطرف إلى posting وإعادة بناء الأرصدة |
| P0 | لا اختبارات ERP | مؤكد/حرج | integration + invariant + concurrency tests قبل الدمج |
| P0 | Float للأموال | مرتفع/عالٍ | Decimal migration |
| P0 | نظامان قابلان للكتابة | مرتفع/حرج | canonical system + freeze + cutover plan |
| P1 | ترقيم read-last+1 | متوسط/عالٍ | atomic sequence |
| P1 | فترات/يوميات اختيارية في SellerCtrl | مرتفع/عالٍ | strict posting configuration |
| P1 | tenant integrity تطبيقية فقط | متوسط/حرج | repository guards + composite constraints حيث أمكن |
| P1 | غياب CRM/HR الحقيقيين | مؤكد/عالٍ تجاريًا | بناء النواة وفق الدورات المحددة |
| P1 | عدم امتثال ETA | مؤكد/حرج عند التشغيل التجاري | compliance module ومراجعة ضريبية |
| P1 | Audit لا يغطي ERP | مرتفع/عالٍ | immutable audit/outbox لكل transition |
| P2 | نقص الوظائف المتقدمة | مؤكد/متوسط | تنفيذ بعد بوابات السلامة والدمج |

## الحكم النهائي

المشروع يملك **أساس ERP حقيقيًا وليس مجرد واجهات**: قيود مزدوجة، مخزون دائم، أوامر وفواتير ومدفوعات ومرتجعات وتقارير. كما أن SellerCtrl أضاف دورة GRNI/Delivery أفضل وهيكل مؤسسة وصلاحيات وتدقيقًا عامًا. لكن النضج الحالي أقرب إلى **ERP داخلي في مرحلة ما قبل الإنتاج** منه إلى بديل قوي لـOdoo أو ERPNext.

الطريق الأقصر ليس إكمال التطبيقين، بل:

1. **SellerCtrl هو المنتج المستهدف.**
2. **Control ERP يصبح مصدر وظائف وبيانات للترحيل ثم read-only.**
3. **سلامة المعاملات والأرقام والأرصدة والاختبارات تسبق CRM/HR والميزات الجديدة.**
4. **بعد P0، تُستكمل دورة البيع والشراء الجزئية، ثم CRM والمستثمرون وHR والامتثال المصري.**

عند تحقيق بوابات P0 واختبارات المصالحة، يصبح المشروع قاعدة مناسبة فعلًا لبناء ERP قوي. قبل ذلك، إضافة شاشات أو موديولات جديدة ستزيد مساحة الخطر أكثر مما تزيد قيمة المنتج.
