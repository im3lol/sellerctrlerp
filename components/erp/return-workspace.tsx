"use client";

import {useMemo,useRef,useState,useTransition}from "react";
import {Search,PackageCheck,PackageX,Clock3,HandCoins,FilePlus2,ChevronLeft,CheckCircle2,AlertCircle}from "lucide-react";
import {getReturnWorkspaceAction,executeReturnWorkflowAction}from "@/app/actions/erp/return-workflow";
import {saveSimpleReturnDecisionAction}from "@/app/actions/erp/simple-return-decision";
import {AdvancedReturnWorkspace}from "./return-workspace-advanced";
import {ItemThumb}from "./item-thumb";
import {Button}from "@/components/ui/button";
import {Input}from "@/components/ui/input";
import {Label}from "@/components/ui/label";
import {Badge}from "@/components/ui/badge";
import {Card,CardHeader,CardTitle,CardContent}from "@/components/ui/card";
import {useT}from "@/lib/i18n/client";
import {toast}from "@/lib/i18n/toast";
import {selectCls}from "@/lib/utils";
import {formatErpDate}from "@/lib/erp/dates";
import {isReturnReviewed}from "@/lib/erp/return-workflow/products";
import type {SimpleDecision}from "@/lib/erp/return-workflow/simple-decision";

type Data=Exclude<Awaited<ReturnType<typeof getReturnWorkspaceAction>>,{error:string}>;
type Action=SimpleDecision["action"];
const labels:Record<Action,string>={WAITING:"منتظر رجوعه",SELLABLE:"وصل سليم",DAMAGED:"وصل تالف — خسائر",CLAIM:"مطالبة تعويض مفتوحة",COMPENSATED:"تم ربط التعويض",CLOSED_LOSS:"مغلق — بدون تعويض إضافي"};
const choices:{key:Action;label:string;description:string;icon:typeof PackageCheck}[]=[
 {key:"SELLABLE",label:"وصل سليم",description:"إرجاع الكمية إلى المخزن",icon:PackageCheck},
 {key:"DAMAGED",label:"وصل تالف",description:"تسجيل تكلفة التالف خسارة",icon:PackageX},
 {key:"WAITING",label:"لم يصل بعد",description:"متابعة المرتجع بدون تغيير الأرصدة",icon:Clock3},
 {key:"CLAIM",label:"فتح مطالبة تعويض",description:"تسجيل المطالبة ومتابعة رد أمازون",icon:FilePlus2},
 {key:"COMPENSATED",label:"ربط تعويض أمازون",description:"البحث برقم التعويض وربطه بالمطالبة",icon:HandCoins},
 {key:"CLOSED_LOSS",label:"إقفال بدون تعويض إضافي",description:"إقفال المطالبة مع إثبات الخسارة مرة واحدة",icon:CheckCircle2},
];
const claimLabels:Record<string,string>={REVIEW:"مطالبة مسجلة",SUBMITTED:"بانتظار رد أمازون",ACCEPTED:"تعويض مقبول — قيد المطابقة",REJECTED:"المطالبة مرفوضة",RECONCILED:"تم ربط التعويض",CLOSED:"المطالبة مغلقة"};
const money=(n:number)=>n.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});

export function ReturnWorkspace({initial}:{initial:Data}){
 const t=useT();const [data,setData]=useState(initial),[busy,start]=useTransition();
 const [query,setQuery]=useState(""),[filter,setFilter]=useState("OPEN"),[itemId,setItemId]=useState("");
 const [action,setAction]=useState<Action>("WAITING"),[feedback,setFeedback]=useState<string|null>(null);
 const [location,setLocation]=useState<"LOCAL"|"AMAZON">("LOCAL");
 const detailRef=useRef<HTMLDivElement>(null);
 const retry=useRef<{signature:string;key:string}|null>(null);
 const detail=data.detail,state=detail?.record.state;
 const product=data.products.find(p=>p.itemId===itemId)??data.products[0];
 const item=data.items.find(i=>i.id===(itemId||product?.itemId));
 const line=state?.lines.find(l=>l.itemId===item?.id),resolution=state?.resolutions?.find(r=>r.itemId===item?.id);
 const invoiceOptions=[...new Map(data.available.filter(a=>a.itemId===item?.id).map(a=>[a.lineId,a])).values()];
 const remaining=line?.expectedQuantity==null?null:Math.max(0,Number(line.expectedQuantity)-Number(line.receivedQuantity)-Number(line.waivedQuantity));
 const defaultQuantity=["SELLABLE","DAMAGED","CLOSED_LOSS"].includes(action)&&remaining!==null&&remaining>0?String(remaining):resolution?.quantity??product?.quantity??"";
 const needsPosting=["SELLABLE","DAMAGED","CLOSED_LOSS","COMPENSATED"].includes(action);
 const permitted=action==="COMPENSATED"?data.capabilities.REIMBURSEMENT:action==="CLOSED_LOSS"?data.capabilities.WAIVE_RETURN:action==="SELLABLE"||action==="DAMAGED"?data.capabilities.RECEIPT:action==="CLAIM"?data.capabilities.CLAIM:data.capabilities.MATCH;
 const shown=useMemo(()=>data.list.filter(c=>{
  const done=isReturnReviewed(c.state,c.products);
  const search=[c.externalOrderId,...c.products.flatMap(p=>[p.name,p.code])].join(" ").toLowerCase();
  return (!query||search.includes(query.toLowerCase()))&&(filter==="ALL"||filter==="DONE"&&done||filter==="OPEN"&&!done||filter==="CLAIMS"&&c.state.claims.some(cl=>!["CLOSED","RECONCILED"].includes(cl.state)));
 }),[data.list,query,filter]);
 const openClaims=data.list.filter(c=>c.state.claims.some(cl=>!["CLOSED","RECONCILED"].includes(cl.state))).length;
 async function reload(caseId=detail?.record.id,page=data.page,selected=itemId){
  const result=await getReturnWorkspaceAction(caseId,page);if("error"in result){setFeedback(result.error);return;}
  setData(result);setItemId(selected||result.products[0]?.itemId||result.available[0]?.itemId||"");
 }
 function selectCase(id:string,productId?:string|null){start(async()=>{setFeedback(null);setAction("WAITING");await reload(id,data.page,productId??"");if(window.innerWidth<1280)setTimeout(()=>detailRef.current?.scrollIntoView({behavior:"smooth",block:"start"}),0);});}
 function submit(form:HTMLFormElement){
  if(!detail||!item)return;const f=new FormData(form),get=(key:string)=>String(f.get(key)??"").trim();
  const payload={caseId:detail.record.id,version:detail.record.version,itemId:item.id,action,quantity:get("quantity"),
   ...(get("warehouseId")?{warehouseId:get("warehouseId")}:{}),...(get("invoiceLineId")?{invoiceLineId:get("invoiceLineId")}:{}),
   location:get("location")||"LOCAL",note:get("note"),...(get("reference")?{reference:get("reference")}:{}),...(get("amount")?{amount:get("amount")}:{}),
   confirmed:f.get("confirmed")==="on",activatePosting:f.get("activatePosting")==="on"};
  const signature=JSON.stringify(payload);if(retry.current?.signature!==signature)retry.current={signature,key:crypto.randomUUID()};
  start(async()=>{setFeedback(null);const result=await saveSimpleReturnDecisionAction({...payload,key:retry.current!.key});
   if("error"in result){setFeedback(result.error??t("راجع المنتج والكمية وبيانات القرار"));toast.error(result.error??"راجع المنتج والكمية وبيانات القرار");return;}
   retry.current=null;toast.success(result.pendingCompensation?"تم حفظ رقم التعويض؛ يظل تحت المتابعة لحين مطابقة الإيداع":"تم حفظ حالة المرتجع");await reload();
  });
 }
 return <div className="space-y-5">
  <div className="grid grid-cols-3 gap-2 sm:gap-3">
   {[{label:"المرتجعات المعروضة",value:data.list.length},{label:"مطالبات تحت المتابعة",value:openClaims},{label:"تمت مراجعتها",value:data.list.filter(c=>isReturnReviewed(c.state,c.products)).length}].map(s=><Card key={s.label} className="py-3"><CardContent className="px-3 sm:px-6"><p className="text-[11px] sm:text-xs text-muted-foreground">{t(s.label)}</p><p className="mt-2 text-xl sm:text-2xl font-bold tabular-nums">{s.value}</p></CardContent></Card>)}
  </div>
  <Card className="py-0"><CardContent className="flex flex-col gap-3 py-4 sm:flex-row"><div className="relative flex-1"><Search className="absolute start-3 top-3 size-4 text-muted-foreground"/><Input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("ابحث باسم المنتج أو كوده أو رقم الطلب")} className="ps-9"/></div><select className={`${selectCls} sm:max-w-56`} value={filter} onChange={e=>setFilter(e.target.value)}><option value="OPEN">{t("يحتاج مراجعة")}</option><option value="CLAIMS">{t("مطالبات التعويض")}</option><option value="DONE">{t("تمت مراجعتها")}</option><option value="ALL">{t("الكل")}</option></select></CardContent></Card>
  {feedback&&<div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 p-4 text-sm text-destructive"><AlertCircle className="size-4 shrink-0"/>{feedback}</div>}
  <div className="grid items-start gap-5 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
   <Card><CardHeader><CardTitle className="text-base">{t("قائمة المرتجعات")}</CardTitle></CardHeader><CardContent className="space-y-3">
    <div className="max-h-72 space-y-3 overflow-y-auto xl:max-h-[70vh]">{shown.map(c=><button key={c.id} disabled={busy} onClick={()=>selectCase(c.id,c.products[0]?.itemId)} className={`w-full rounded-xl border p-3 text-start transition-colors ${detail?.record.id===c.id?"border-primary bg-primary/5":"hover:bg-muted/40"}`}>
     {c.products.length?c.products.map(p=><div key={p.itemId??p.code} className="flex items-center gap-3 py-1"><ItemThumb src={p.image} className="size-14"/><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-semibold">{p.name}</p><p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">{p.code}</p><p className="mt-1 text-xs text-muted-foreground">{t("الكمية")}: {p.quantity??t("غير محددة")}</p></div></div>):<p className="text-sm font-medium">{t("مرتجع يحتاج تحديد المنتج")}</p>}
     <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3"><span className="font-mono text-[11px] text-muted-foreground" dir="ltr">{c.externalOrderId.replace(/^(REIMBURSEMENT|REMOVAL):/,"")}</span><Badge variant="secondary">{t(c.state.resolutions?.at(-1)?labels[c.state.resolutions.at(-1)!.action]:"لم تُراجع حالته بعد")}</Badge></div>
    </button>)}</div>
    {!shown.length&&<p className="py-8 text-center text-sm text-muted-foreground">{t("لا توجد مرتجعات مطابقة لهذا البحث")}</p>}
    <div className="flex items-center justify-between gap-2 pt-2"><Button variant="outline" size="sm" disabled={busy||data.page<=1} onClick={()=>start(()=>reload(undefined,data.page-1,""))}>{t("السابق")}</Button><span className="text-xs text-muted-foreground">{t("صفحة")} {data.page}</span><Button variant="outline" size="sm" disabled={busy||data.list.length<200} onClick={()=>start(()=>reload(undefined,data.page+1,""))}>{t("التالي")}</Button></div>
   </CardContent></Card>
   {!detail||!state?<Card><CardContent className="flex flex-col items-center gap-3 py-20 text-center"><PackageCheck className="size-10 text-primary"/><p className="font-semibold">{t("اختر المرتجع لعرض المنتج وتحديد حالته")}</p><p className="max-w-sm text-sm text-muted-foreground">{t("القرار واضح: مخزن، خسائر، أو مطالبة تعويض. الحسابات تتم خلف الواجهة.")}</p></CardContent></Card>:<div ref={detailRef} className="min-w-0 scroll-mt-20 space-y-5">
    <Card><CardContent className="space-y-4 pt-5"><div className="flex items-start gap-4"><ItemThumb src={item?.image??product?.image} className="size-24 sm:size-28"/><div className="min-w-0 flex-1"><p className="text-lg font-bold">{item?.name??product?.name??t("حدد المنتج")}</p><p className="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">{item?.code??product?.code}</p><div className="mt-3 flex flex-wrap gap-2"><Badge variant="secondary">{t(resolution?labels[resolution.action]:"لم تُراجع حالته بعد")}</Badge>{state.fulfillment!=="UNKNOWN"&&<Badge variant="outline">{state.fulfillment==="FBA"?"Amazon FBA":"Amazon FBM"}</Badge>}</div></div></div>
     {data.products.length>1&&<select className={selectCls} value={itemId} onChange={e=>setItemId(e.target.value)}>{data.products.filter(p=>p.itemId).map(p=><option key={p.itemId} value={p.itemId!}>{p.name} — {p.code}</option>)}</select>}
     {!item&&<div className="space-y-2"><Label>{t("اختيار المنتج الصحيح")}</Label><select className={selectCls} value={itemId} onChange={e=>setItemId(e.target.value)}><option value="">{t("اختر الصنف")}</option>{data.items.map(i=><option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}</select></div>}
     <div className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2"><div><span className="text-muted-foreground">{t("رقم الطلب")}: </span><span dir="ltr" className="inline-block font-mono text-xs">{detail.record.externalOrderId.replace(/^(REIMBURSEMENT|REMOVAL):/,"")}</span></div><div><span className="text-muted-foreground">{t("الكمية المسجلة")}: </span>{product?.quantity??line?.expectedQuantity??t("غير محددة")}</div>{product?.reason&&<div className="sm:col-span-2"><span className="text-muted-foreground">{t("سبب المرتجع")}: </span>{product.reason}</div>}{product?.sourceCondition&&<div><span className="text-muted-foreground">{t("حالة أمازون")}: </span>{t(product.sourceCondition==="SELLABLE"?"سليم بحسب أمازون":"يحتاج فحص")}</div>}{line&&<div><span className="text-muted-foreground">{t("تم استلامه")}: </span>{line.receivedQuantity} <span className="ms-2 text-muted-foreground">{t("سُجّل خسارة")}: </span>{line.writtenOffQuantity}</div>}</div>
    </CardContent></Card>
    {state.exception&&<Card><CardContent className="space-y-3 py-4"><p className="flex items-center gap-2 text-sm"><AlertCircle className="size-4 text-primary"/>{t("وصلت معلومات جديدة من أمازون؛ راجع بيانات المرتجع قبل القرار")}</p>{data.capabilities.EXCEPTION&&<Button variant="outline" disabled={busy} onClick={()=>start(async()=>{const result=await executeReturnWorkflowAction({caseId:detail.record.id,version:detail.record.version,key:crypto.randomUUID(),kind:"EXCEPTION",payload:{clear:true,reason:"تمت مراجعة بيانات المنتج والمرتجع والمعلومات الجديدة المعروضة"}});if("error"in result)setFeedback(result.error);else await reload();})}>{t("راجعت المعلومات المعروضة")}</Button>}</CardContent></Card>}
    <Card><CardHeader><CardTitle className="text-base">{t("حالة المنتج والقرار")}</CardTitle></CardHeader><CardContent className="space-y-5">
     <div className="grid gap-2 sm:grid-cols-2">{choices.map(c=><button key={c.key} aria-pressed={action===c.key} onClick={()=>{setAction(c.key);setFeedback(null);}} className={`flex items-start gap-3 rounded-xl border p-3 text-start transition-colors ${action===c.key?"border-primary bg-primary/5":"hover:bg-muted/40"}`}><c.icon className="mt-0.5 size-5 shrink-0 text-primary"/><span><span className="block text-sm font-semibold">{t(c.label)}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{t(c.description)}</span></span></button>)}</div>
     <form key={`${detail.record.id}:${item?.id}:${action}`} onSubmit={e=>{e.preventDefault();submit(e.currentTarget);}} className="space-y-4 border-t pt-4">
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="simple-quantity">{t("الكمية")}</Label><Input id="simple-quantity" name="quantity" defaultValue={defaultQuantity} required inputMode="decimal" placeholder={t("أدخل الكمية الفعلية")}/></div>
       {invoiceOptions.length>1&&<div className="space-y-1.5"><Label>{t("الفاتورة الأصلية")}</Label><select name="invoiceLineId" className={selectCls} required><option value="">{t("اختر الفاتورة")}</option>{invoiceOptions.map(a=><option key={a.lineId} value={a.lineId}>{a.invoiceNumber} — {a.quantity}</option>)}</select></div>}
       {(action==="SELLABLE"||action==="DAMAGED")&&<><div className="space-y-1.5"><Label>{t("مكان الاستلام")}</Label><select name="location" className={selectCls} value={location} onChange={e=>setLocation(e.target.value as "LOCAL"|"AMAZON")}><option value="LOCAL">{t("وصل إلى مخزني")}</option><option value="AMAZON">{t("رجع إلى مخزن أمازون")}</option></select></div>{action==="SELLABLE"&&<div className="space-y-1.5 sm:col-span-2"><Label>{t("مخزن الاستلام")}</Label><select name="warehouseId" className={selectCls} required><option value="">{t("اختر المخزن")}</option>{data.warehouses.filter(w=>location==="AMAZON"?w.marketplace:!w.marketplace).map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></div>}</>}
       {(action==="CLAIM"||action==="COMPENSATED")&&<><div className="space-y-1.5"><Label>{t(action==="COMPENSATED"?"رقم تعويض أمازون":"رقم المطالبة إن وجد")}</Label><Input name="reference" required={action==="COMPENSATED"} defaultValue={action==="COMPENSATED"?"":state.claims.find(c=>c.lineId===line?.id)?.reference??""} placeholder={t("اكتب الرقم كما هو في أمازون")} dir="ltr"/></div>{action==="CLAIM"&&<div className="space-y-1.5"><Label>{t("المبلغ المطالب به — اختياري")}</Label><Input name="amount" inputMode="decimal"/></div>}</>}
      </div>
      {action==="COMPENSATED"&&<p className="text-xs leading-5 text-muted-foreground">{t("لن نعتبر التعويض مستلمًا إلا بعد العثور على رقمه ومطابقة المبلغ المسجل فعليًا.")}</p>}
      {action==="CLAIM"&&<p className="text-xs leading-5 text-muted-foreground">{t("سجّل المطالبة هنا، وأضف رقم مطالبة أمازون عند تقديمها؛ تسجيلها لا يعني قبول التعويض.")}</p>}
      <div className="space-y-1.5"><Label htmlFor="simple-note">{t(action==="CLOSED_LOSS"?"سبب الإقفال بدون تعويض":"ملاحظاتك — اختياري")}</Label><textarea id="simple-note" name="note" className="min-h-20 w-full rounded-lg border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" required={action==="CLOSED_LOSS"} minLength={action==="CLOSED_LOSS"?5:undefined}/></div>
      {needsPosting&&<label className="flex items-start gap-2 rounded-lg bg-muted/30 p-3 text-sm leading-6"><input className="mt-1.5" type="checkbox" name="confirmed" required/>{t(action==="SELLABLE"?"أؤكد استلام الكمية سليمة وإرجاعها للمخزن المحدد":action==="DAMAGED"?"أؤكد تلف الكمية وتسجيل تكلفتها خسارة":action==="COMPENSATED"?"أؤكد ربط رقم التعويض بعد التحقق من بياناته":"أؤكد إقفال المطالبة؛ لن تتكرر خسارة سبق تسجيلها")}</label>}
      {needsPosting&&data.config.mode!=="MANUAL"&&data.canConfigure&&<label className="flex items-start gap-2 text-sm leading-6"><input className="mt-1.5" type="checkbox" name="activatePosting" required/>{t("تفعيل تنفيذ قراراتي المؤكدة فقط، بدون تسوية تلقائية للسجلات القديمة")}</label>}
      <Button disabled={busy||!item||!permitted||!!state.exception} className="w-full sm:w-auto">{busy?t("جارٍ الحفظ…"):t(action==="SELLABLE"?"تأكيد الإرجاع للمخزن":action==="DAMAGED"?"تسجيل التالف بالخسائر":action==="CLAIM"?"حفظ المطالبة":action==="COMPENSATED"?"التحقق وربط التعويض":action==="CLOSED_LOSS"?"إقفال المطالبة والمرتجع":"حفظ حالة الانتظار")}<ChevronLeft className="ms-2 size-4 rtl:rotate-0 ltr:rotate-180"/></Button>
     </form>
    </CardContent></Card>
    {!!state.claims.length&&<Card><CardHeader><CardTitle className="text-base">{t("مطالبات وتعويضات هذا المرتجع")}</CardTitle></CardHeader><CardContent className="space-y-3">{state.claims.map(c=><div key={c.id} className="rounded-xl border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><span>{c.reference??t("مطالبة بدون رقم بعد")}</span><Badge variant="secondary">{t(claimLabels[c.state])}</Badge></div><p className="mt-2 text-muted-foreground">{c.reason}</p>{c.reconciledCash&&Number(c.reconciledCash)>0&&<p className="mt-2 font-semibold">{t("التعويض المطابق")}: {money(Number(c.reconciledCash))} {c.currency}</p>}{c.decisionReason&&<p className="mt-2 text-muted-foreground">{c.decisionReason}</p>}</div>)}</CardContent></Card>}
    {data.canFinance&&<details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm font-medium">{t("المبالغ والرسوم حسب كشف أمازون")}</summary><div className="mt-3 space-y-3">{detail.events.filter((e,i,all)=>e.kind==="REFUND"&&all.findIndex(x=>x.kind==="REFUND"&&x.sourceId===e.sourceId)===i).map(e=>{const fees=Number(e.payload.sellingFees??0)+Number(e.payload.fbaFees??0)+Number(e.payload.otherTransactionFees??0),net=Number(e.payload.total??0);return <div key={e.id} className="grid gap-2 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2"><p>{e.happenedAt?formatErpDate(e.happenedAt,"en-GB"):t("غير محدد")}</p><p>{t("صافي حركة الرصيد")}: {money(net)} {e.currency}</p><p>{t("الرسوم المستردة أو المخصومة")}: {money(fees)} {e.currency}</p>{!Number(e.payload.other??0)&&<p>{t("المبلغ المردود للعميل")}: {money(fees-net)} {e.currency}</p>}</div>;})}</div></details>}
   </div>}
  </div>
  {data.canConfigure&&data.canFinance&&<details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer text-sm text-muted-foreground">{t("إعدادات ومراجعة المحاسب")}</summary><div className="mt-4"><AdvancedReturnWorkspace key={data.detail?.record.version??"initial"} initial={data} onChanged={()=>reload()}/></div></details>}
 </div>;
}
