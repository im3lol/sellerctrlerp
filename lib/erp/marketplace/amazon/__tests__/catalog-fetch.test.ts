import { describe,it,expect,vi } from 'vitest';
import { fetchCatalog } from '../catalog';
import { spJson } from '../client';
vi.mock('../client',()=>({spJson:vi.fn(),paced:(_k:string,_n:number,f:()=>Promise<unknown>)=>f(),credKey:()=> 'test'}));
it('requests 20 catalog results and follows pagination without enriching unrelated ASINs',async()=>{
 vi.mocked(spJson).mockResolvedValueOnce({items:[{asin:'A'}],pagination:{nextToken:'page-two'}}).mockResolvedValueOnce({items:[{asin:'B'},{asin:'UNRELATED'}]});
 const records=await fetchCatalog({refreshToken:'x',sellerId:'s',marketplaceId:'m',region:'eu'},['A','B']);
 expect(records.map(r=>r.asin)).toEqual(['A','B']);
 const first=new URL(String(vi.mocked(spJson).mock.calls[0][1]),'https://example.test');
 const second=new URL(String(vi.mocked(spJson).mock.calls[1][1]),'https://example.test');
 expect(first.searchParams.get('pageSize')).toBe('20');expect(second.searchParams.get('pageToken')).toBe('page-two');
});
