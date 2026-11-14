export type LabelPrintLayout={width:number;height:number;offsetX:number;offsetY:number};
export const DEFAULT_LABEL_LAYOUT:LabelPrintLayout={width:50,height:25,offsetX:0,offsetY:0};
export const LABEL_LAYOUT_KEY="sellerctrl:label-layout:v1";
/** Physical dimensions are numbers only; never interpolate arbitrary storage into CSS. */
export function normalizeLabelLayout(value:unknown):LabelPrintLayout {
 const v=(value&&typeof value==="object"?value:{}) as Record<string,unknown>;
 const number=(key:keyof LabelPrintLayout,min:number,max:number)=>typeof v[key]==="number"&&Number.isFinite(v[key])&&Number(v[key])>=min&&Number(v[key])<=max?Math.round(Number(v[key])*10)/10:DEFAULT_LABEL_LAYOUT[key];
 return {width:number("width",30,150),height:number("height",20,150),offsetX:number("offsetX",-5,5),offsetY:number("offsetY",-5,5)};
}
