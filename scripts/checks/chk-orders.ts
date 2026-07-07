import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, salesOrders, salesOrderLines, purchaseOrders, purchaseOrderLines } from "@/db/schema";
async function main(){
  const [org]=await db.select().from(organizations).limit(1);
  const so=await db.select({n:salesOrders.number,st:salesOrders.status,t:salesOrders.totalAmount}).from(salesOrders).where(eq(salesOrders.organizationId,org.id));
  for(const o of so){const [c]=await db.select({c:sql<number>`count(*)`}).from(salesOrderLines).innerJoin(salesOrders,eq(salesOrders.id,salesOrderLines.salesOrderId)).where(eq(salesOrders.number,o.n));console.log("SO",o.n,o.st,"total",o.t,"lines",c.c);}
  const po=await db.select({n:purchaseOrders.number,st:purchaseOrders.status,t:purchaseOrders.totalAmount}).from(purchaseOrders).where(eq(purchaseOrders.organizationId,org.id));
  for(const o of po){const [c]=await db.select({c:sql<number>`count(*)`}).from(purchaseOrderLines).innerJoin(purchaseOrders,eq(purchaseOrders.id,purchaseOrderLines.purchaseOrderId)).where(eq(purchaseOrders.number,o.n));console.log("PO",o.n,o.st,"total",o.t,"lines",c.c);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
