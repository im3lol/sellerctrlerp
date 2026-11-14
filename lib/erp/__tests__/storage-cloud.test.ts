import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ platformIntegrations: {}, storageCloudConnections: {} }));
import { createCloudState, verifyCloudState } from "../storage-cloud-state";
import { driveFolderUrl, uploadGoogleBackup, createGoogleBackupFolder, trashGoogleJobFolder, createGoogleFolder } from "../storage-cloud";

beforeEach(() => { vi.stubEnv("AUTH_SECRET", "storage-test-key-which-is-not-used-in-production"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("cloud consent boundaries", () => {
  it("binds consent to the initiating user, organization, nonce and expiry", () => {
    const state = createCloudState("user", "org", 1000);
    expect(verifyCloudState(state.cookie, state.nonce, "user", "org", 2000)).toBeTruthy();
    expect(verifyCloudState(state.cookie, "wrong", "user", "org", 2000)).toBeNull();
    expect(verifyCloudState(state.cookie, state.nonce, "other", "org", 2000)).toBeNull();
    expect(verifyCloudState(state.cookie, state.nonce, "user", "foreign", 2000)).toBeNull();
    expect(verifyCloudState(state.cookie, state.nonce, "user", "org", 601001)).toBeNull();
    expect(verifyCloudState(state.cookie + "tamper", state.nonce, "user", "org", 2000)).toBeNull();
  });
  it("uses a fresh OAuth nonce and PKCE challenge per attempt", () => {
    const a = createCloudState("u", "o"), b = createCloudState("u", "o");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.challenge).not.toBe(b.challenge);
    expect(a.cookie).not.toContain('"userId"');
  });
});
describe("Drive uploads", () => {
  it("does not turn an untrusted folder id into an external link", () => {
    expect(driveFolderUrl("../../evil")).toBeNull();
    expect(driveFolderUrl("folder_123")).toBe("https://drive.google.com/drive/folders/folder_123");
  });
  it("never sends a backup or access token to an upload destination outside Google", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200, headers: { location: "https://attacker.test/upload/drive/" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(uploadGoogleBackup("private-token", "folder", "data.json.gz", Buffer.from("private-data"))).rejects.toThrow("Invalid cloud upload destination");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uploads only into the authorized connection folder and requires a confirmed id", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" } })).mockResolvedValueOnce(Response.json({ id: "saved-file" }));
    vi.stubGlobal("fetch", fetcher);
    expect(await uploadGoogleBackup("token", "own-folder", "data.json.gz", Buffer.from("gzip"))).toBe("saved-file");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).parents).toEqual(["own-folder"]);
    expect(fetcher.mock.calls[1][1].redirect).toBe("error");
  });
});

it("marks a new dated folder with the durable job identity",async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({id:"managed-folder"}));vi.stubGlobal("fetch",fetcher);
 await createGoogleBackupFolder("token","root","2026-11-14 20-00-00","job-1");
 const body=JSON.parse(fetcher.mock.calls[0][1].body);expect(body.parents).toEqual(["root"]);expect(body.appProperties.sellerctrlJob).toBe("job-1");
});
it("never applies retention to the root or an unmanaged legacy folder",async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({mimeType:"application/vnd.google-apps.folder",parents:["root"],appProperties:{}}));vi.stubGlobal("fetch",fetcher);
 await expect(trashGoogleJobFolder("token","root","job-1","root")).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 await expect(trashGoogleJobFolder("token","legacy","job-1","root")).rejects.toThrow("Unmanaged");expect(fetcher).toHaveBeenCalledTimes(1);
});
it("moves only the exact managed folder into trash rather than permanently deleting it",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({mimeType:"application/vnd.google-apps.folder",parents:["root"],appProperties:{sellerctrlJob:"job-1"},trashed:false})).mockResolvedValueOnce(Response.json({trashed:true}));vi.stubGlobal("fetch",fetcher);
 await trashGoogleJobFolder("token","managed","job-1","root");expect(fetcher.mock.calls[1][1].method).toBe("PATCH");expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({trashed:true});
});

it("reuses a verified same-account organization folder on reconnection",async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({user:{emailAddress:"owner@example.test"}})).mockResolvedValueOnce(Response.json({mimeType:"application/vnd.google-apps.folder",trashed:false,appProperties:{sellerctrlOrg:"own"},capabilities:{canAddChildren:true}}));vi.stubGlobal("fetch",fetcher);
 const result=await createGoogleFolder("token","own","Company",{folderId:"previous-root",accountEmail:"owner@example.test"});expect(result).toEqual({folderId:"previous-root",email:"owner@example.test",reused:true});expect(fetcher).toHaveBeenCalledTimes(2);expect(fetcher.mock.calls.every(c=>!c[1].method)).toBe(true);
});
