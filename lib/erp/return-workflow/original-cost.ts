import {scaled}from "./model";
/** Do not silently round each partial credit and lose a cent from the original
 * issue. Non-divisible costs stay held until an explicit allocation is approved. */
export function originalReceiptCost(total:string,originalQuantity:string,quantity:string){
 const cost=scaled(total),original=scaled(originalQuantity),returned=scaled(quantity);
 if(cost<BigInt(0)||original<=BigInt(0)||returned<=BigInt(0)||returned>original)throw new Error("Invalid original cost allocation");
 const denominator=original*BigInt(100);
 if(returned<original&&(cost*returned)%denominator!==BigInt(0))throw new Error("A partial return with fractional-cent original cost needs an explicit rounding-allocation review");
 const cents=(cost*returned+denominator/BigInt(2))/denominator;
 return {unitCost:Number(cost)/Number(original),value:Number(cents)/100};
}
