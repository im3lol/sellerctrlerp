import {expect,it} from "vitest";
import {normalizeLabelLayout} from "../label-layout";
import {buildLabelBatchDocument} from "../label-batch";
import {formatBackupDate,dailyCloudBackupDue} from "../backup-date";
it("validates stored calibration before inserting CSS",()=>{expect(normalizeLabelLayout({width:'50;url(secret)',height:Infinity,offsetX:10,offsetY:NaN})).toEqual({width:50,height:25,offsetX:0,offsetY:0});const html=buildLabelBatchDocument([{itemName:"Item",value:"123"}],{width:60,height:40,offsetX:1.2,offsetY:-1});expect(html).toContain('@page{size:60mm 40mm');expect(html).toContain('translate(1.2mm,-1mm)');});
it("uses Cairo time consistently across midnight and daylight saving",()=>{expect(formatBackupDate('2026-11-14T23:30:00Z','en')).toBe('15/11/2026, 01:30');expect(formatBackupDate('2026-07-14T22:30:00Z','en')).toBe('15/07/2026, 01:30');expect(formatBackupDate('invalid','en')).toBe('—');});

it("runs an opted-in daily backup only after 03:00 Cairo and not twice on the same date",()=>{
 expect(dailyCloudBackupDue(false,null,new Date("2026-11-14T12:00:00Z"))).toBe(false);
 expect(dailyCloudBackupDue(true,null,new Date("2026-11-14T00:59:00Z"))).toBe(false);
 expect(dailyCloudBackupDue(true,null,new Date("2026-11-14T01:00:00Z"))).toBe(true);
 expect(dailyCloudBackupDue(true,new Date("2026-11-14T02:00:00Z"),new Date("2026-11-14T18:00:00Z"))).toBe(false);
 expect(dailyCloudBackupDue(true,new Date("2026-11-13T12:00:00Z"),new Date("2026-11-14T18:00:00Z"))).toBe(true);
});
