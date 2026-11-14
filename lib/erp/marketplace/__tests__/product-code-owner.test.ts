import {describe,it,expect} from 'vitest';
import {classifyProducts} from '../classify';
it('attaches a reused SKU to its current ASIN even if another item owns the historical SKU',()=>{
 const r=classifyProducts([{code:'REUSED',altCode:'NEW',name:'Current',sellPrice:10}],new Map([['NEW','new-item']]),new Set(['REUSED']),'link',new Map([['old-item',new Set(['REUSED'])],['new-item',new Set(['NEW'])]]));
 expect(r.toLink).toEqual([{itemId:'new-item',sku:'REUSED',fnsku:undefined}]);expect(r.alreadyLinked).toBe(0);
});
