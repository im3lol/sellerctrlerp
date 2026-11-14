import type { Locale } from "@/lib/i18n";
export const BACKUP_TIME_ZONE="Africa/Cairo";
export function formatBackupDate(value:Date|string|null|undefined,locale:Locale="ar") {
 if(!value)return "—";
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return "—";
 return new Intl.DateTimeFormat(locale==="ar"?"ar-EG-u-nu-latn":"en-GB",{timeZone:BACKUP_TIME_ZONE,calendar:"gregory",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(date);
}

export function cairoDay(value:Date) {
 return new Intl.DateTimeFormat("en-CA",{timeZone:BACKUP_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
}
export function dailyCloudBackupDue(enabled:boolean,lastCreatedAt:Date|null,now=new Date()) {
 const hour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:BACKUP_TIME_ZONE,hour:"2-digit",hourCycle:"h23"}).format(now));
 return enabled&&hour>=3&&(!lastCreatedAt||cairoDay(lastCreatedAt)!==cairoDay(now));
}
