import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectProductScope, groupProductMasters } from '../../product-scope';
import { mergeProducts, listingToProduct, fetchListings, ListingsResultLimitError } from '../listings';
import { parseListingsReport, fetchFullListings } from '../reports';
import { fetchInventoryProducts } from '../inventory';
import { amazonConnector } from '../connector';
vi.mock('../listings', async(importOriginal)=>({...await importOriginal<typeof import('../listings')>(),fetchListings:vi.fn()}));
vi.mock('../reports', async(importOriginal)=>({...await importOriginal<typeof import('../reports')>(), fetchFullListings:vi.fn()}));
vi.mock('../inventory', async(importOriginal)=>({...await importOriginal<typeof import('../inventory')>(), fetchInventoryProducts:vi.fn()}));
const cred={refreshToken:'test',sellerId:'seller',marketplaceId:'mp',region:'eu'};
const current={code:'REUSED',altCode:'NEW',name:'Current name',sellPrice:100,fulfillment:'FBA' as const};
beforeEach(()=>vi.resetAllMocks());
describe('current Amazon products',()=>{
 it('does not import historical FBA rows and does not reuse a stale ASIN or FNSKU',()=>{
  const products=mergeProducts([{...current,altCode:'OLD',fnsku:'STALE'},{code:'DELETED',altCode:'OLD2',name:'Old',sellPrice:0}], [current]);
  expect(products).toEqual([current]);
 });
 it('attaches FNSKU only when SKU and ASIN match',()=>{
  expect(mergeProducts([{...current,fnsku:'VALID'}],[current])[0].fnsku).toBe('VALID');
  expect(mergeProducts([{...current,fnsku:'STALE'}],[{...current,fulfillment:'FBM'}])[0].fnsku).toBeUndefined();
  expect(mergeProducts([{...current,fnsku:'VALID'},{...current,altCode:'OLD',fnsku:'STALE'}],[current])[0].fnsku).toBe('VALID');
 });
 it.each(['fetchProducts','fetchFullProducts'] as const)('%s uses the full current report',async(method)=>{
  vi.mocked(fetchFullListings).mockResolvedValue([current]);
  vi.mocked(fetchInventoryProducts).mockResolvedValue([{...current,fnsku:'MATCH'},{...current,code:'OLD-SKU'}]);
  const result=await amazonConnector[method]!(cred);
  expect(result).toEqual([{...current,fnsku:'MATCH'}]);
 });
 it.each(['fetchProducts','fetchFullProducts'] as const)('%s fails closed if the current report fails',async(method)=>{
  vi.mocked(fetchFullListings).mockRejectedValue(new Error('report unavailable'));
  await expect(amazonConnector[method]!(cred)).rejects.toThrow('report unavailable');
  expect(fetchInventoryProducts).not.toHaveBeenCalled();
 });
 it('falls back to the complete current report when incremental listing results hit the limit',async()=>{
  vi.mocked(fetchListings).mockRejectedValue(new ListingsResultLimitError('limit'));
  vi.mocked(fetchFullListings).mockResolvedValue([current]);vi.mocked(fetchInventoryProducts).mockResolvedValue([]);
  expect(await amazonConnector.fetchProducts!(cred,new Date())).toEqual([current]);
 });
 it('does not replace an incremental network failure with historical FBA rows',async()=>{
  vi.mocked(fetchListings).mockRejectedValue(new Error('network'));
  await expect(amazonConnector.fetchProducts!(cred,new Date())).rejects.toThrow('network');
  expect(fetchInventoryProducts).not.toHaveBeenCalled();
 });
 it('does not require FBA metadata to keep a valid current listing',async()=>{
  vi.mocked(fetchFullListings).mockResolvedValue([current]);vi.mocked(fetchInventoryProducts).mockRejectedValue(new Error('inventory unavailable'));
  expect(await amazonConnector.fetchFullProducts!(cred)).toEqual([current]);
 });
 it('keeps inactive and zero-stock current FBA listings; excludes FBM',()=>{
  const report='seller-sku\tasin1\titem-name\tprice\tfulfillment-channel\tstatus\nFBA1\tA\tZero stock\t0\tAMAZON_EU\tInactive\nFBM1\tB\tSeller fulfilled\t5\tDEFAULT\tActive';
  const products=parseListingsReport(report);
  expect(selectProductScope(products,'AMAZON','FBA').map(p=>p.code)).toEqual(['FBA1']);
  expect(selectProductScope(products,'AMAZON','FBM').map(p=>p.code)).toEqual(['FBM1']);
  expect(selectProductScope(products,'AMAZON',null)).toHaveLength(2);
 });
 it('fails on missing fulfillment rather than guessing FBA from history',()=>{
  expect(()=>selectProductScope([{...current,fulfillment:undefined}],'AMAZON','FBA')).toThrow('fulfillment');
  expect(selectProductScope([{...current,fulfillment:undefined}],'SHOPIFY','FBA')).toHaveLength(1);
 });
 it('reads incremental listing fulfillment from listing metadata',()=>{
  expect(listingToProduct({sku:'F',fulfillmentAvailability:[{fulfillmentChannelCode:'AMAZON_EU'}]})?.fulfillment).toBe('FBA');
 });
 it('groups several current SKUs of one ASIN without losing aliases',()=>{
  const grouped=groupProductMasters([current,{...current,code:'SECOND',fnsku:'OTHER'}, {...current,altCode:'DIFFERENT'}]);
  expect(grouped.map(g=>g.length)).toEqual([2,1]);expect(grouped[0].map(p=>p.code)).toEqual(['REUSED','SECOND']);
 });
});
