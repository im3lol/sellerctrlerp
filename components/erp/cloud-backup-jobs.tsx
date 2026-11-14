"use client";
import { useEffect, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/client";
import { formatBackupDate } from "@/lib/erp/backup-date";
import { sendGoogleDriveBackupAction } from "@/app/actions/storage-cloud";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";

type Row={id:string;status:string;completedFiles:number;totalFiles:number;errorCode:string|null;folderId:string|null;createdAt:Date|string;finishedAt:Date|string|null;prunedAt:Date|string|null};
const LABELS:Record<string,string>={QUEUED:"في انتظار التنفيذ",RUNNING:"جارٍ رفع الملفات",RETRYING:"ستتم إعادة المحاولة تلقائيًا",FAILED:"لم تكتمل النسخة",COMPLETED:"اكتملت النسخة"};
const ERRORS:Record<string,string>={reconnect:"أعد ربط الحساب ثم استكمل النسخة",permissions:"راجع صلاحية ملفات التطبيق ثم أعد الربط",quota:"مساحة Google Drive غير كافية",temporary:"اتصال مؤقت غير متاح؛ يمكن استكمال الملفات الناقصة",connect:"تعذّر إتمام النسخة؛ راجع الاتصال ثم أعد المحاولة", "drive-api":"فعّل Google Drive API ثم استكمل النسخة", "client-config":"راجع إعدادات ربط Google لدى إدارة المنصة"};
export function CloudBackupJobs({initial}:{initial:Row[]}) {
 const [rows,setRows]=useState(initial);const [offline,setOffline]=useState(false);const t=useT(),locale=useLocale();
 const active=rows.some(r=>["QUEUED","RUNNING","RETRYING"].includes(r.status));
 useEffect(()=>{
  let stopped=false;const controller=new AbortController();
  const poll=async()=>{if(document.hidden)return;try{const r=await fetch("/api/storage/cloud/jobs",{cache:"no-store",signal:controller.signal});if(!r.ok)throw new Error("Unavailable");const data=await r.json();if(!stopped){setRows(data.jobs);setOffline(false);}}catch{if(!stopped)setOffline(true);}};
  const timer=window.setInterval(poll,active?5000:30000);return()=>{stopped=true;controller.abort();window.clearInterval(timer);};
 },[active]);
 return <Card><CardHeader><CardTitle>{t("متابعة نسخ Google Drive")}</CardTitle><CardDescription>{t("يمكنك إغلاق الصفحة؛ الرفع مستمر في الخلفية. جميع الأوقات بتوقيت القاهرة.")}</CardDescription></CardHeader><CardContent className="space-y-3">
 {offline&&<p role="status" className="text-sm text-muted-foreground">{t("تعذّر تحديث الحالة مؤقتًا؛ هذا لا يوقف مهمة النسخ")}</p>}
 {!rows.length&&<p className="text-sm text-muted-foreground">{t("لم تبدأ مهام نسخ جديدة بعد؛ النسخ السابقة موجودة في مجلد Drive")}</p>}
 {rows.map(row=><div key={row.id} className="space-y-3 rounded-xl border p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold" role="status">{t(row.prunedAt?"نُقلت إلى سلة مهملات Drive":LABELS[row.status]||"في انتظار التنفيذ")}</span><time className="text-xs text-muted-foreground" dir="ltr">{formatBackupDate(row.createdAt,locale)}</time></div>
 <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t("الملفات المكتملة")} aria-valuemin={0} aria-valuemax={row.totalFiles||1} aria-valuenow={row.completedFiles}><div className="h-full bg-primary transition-all" style={{width:`${row.totalFiles?Math.min(100,row.completedFiles/row.totalFiles*100):0}%`}} /></div>
 <p className="text-xs text-muted-foreground">{t("الملفات المكتملة")}: <span dir="ltr">{row.completedFiles} / {row.totalFiles||"—"}</span></p>
 {row.errorCode&&<p className="text-sm text-destructive">{t(ERRORS[row.errorCode]||"تعذّر إتمام النسخة؛ راجع الاتصال ثم أعد المحاولة")}</p>}
 <div className="flex flex-wrap gap-2">{row.status==="FAILED"&&<form action={sendGoogleDriveBackupAction}><input type="hidden" name="resumeId" value={row.id}/><Button type="submit" size="sm" variant="outline" disabled={active}>{t("استكمال الملفات الناقصة")}</Button></form>}{row.folderId&&!row.prunedAt&&/^[A-Za-z0-9_-]+$/.test(row.folderId)&&<Button asChild size="sm" variant="outline"><a href={`https://drive.google.com/drive/folders/${row.folderId}`} target="_blank" rel="noopener noreferrer">{t("فتح مجلد النسخة")}</a></Button>}</div>
 </div>)}
 </CardContent></Card>;
}
