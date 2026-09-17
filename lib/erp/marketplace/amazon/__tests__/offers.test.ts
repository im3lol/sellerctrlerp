import { describe, it, expect } from "vitest";
import { parseListingOffers } from "../offers";

const egp = (Amount: number) => ({ CurrencyCode: "EGP", Amount });

describe("a listing's competitive picture", () => {
  it("knows when I hold the Buy Box, on landed prices", () => {
    const s = parseListingOffers("SKU-1", {
      Summary: { BuyBoxPrices: [{ condition: "New", LandedPrice: egp(1026) }], LowestPrices: [{ condition: "new", LandedPrice: egp(990) }], TotalOfferCount: 4 },
      Offers: [{ MyOffer: true, IsBuyBoxWinner: true, ListingPrice: egp(1000), Shipping: egp(26) }],
    });
    expect(s).toEqual({ sku: "SKU-1", currency: "EGP", myPrice: 1026, buyBoxPrice: 1026, lowestPrice: 990, offerCount: 4, isWinner: true });
  });

  it("knows when someone else has it", () => {
    const s = parseListingOffers("SKU-2", {
      Summary: { BuyBoxPrices: [{ condition: "New", ListingPrice: egp(1650), Shipping: egp(26) }], TotalOfferCount: 2 },
      Offers: [
        { MyOffer: false, IsBuyBoxWinner: true, ListingPrice: egp(1650), Shipping: egp(26) },
        { MyOffer: true, IsBuyBoxWinner: false, ListingPrice: egp(1700), Shipping: egp(0) },
      ],
    });
    expect(s.isWinner).toBe(false);
    expect(s.buyBoxPrice).toBe(1676);
    expect(s.myPrice).toBe(1700);
  });

  it("says nobody has it when Amazon shows no Buy Box", () => {
    const s = parseListingOffers("SKU-3", { Summary: { TotalOfferCount: 1 }, Offers: [{ MyOffer: true, ListingPrice: egp(500) }] });
    expect(s.isWinner).toBeNull();
    expect(s.buyBoxPrice).toBeNull();
  });

  it("still reads the market when my own offer isn't in the list", () => {
    const s = parseListingOffers("SKU-4", {
      Summary: { BuyBoxPrices: [{ condition: "Used", LandedPrice: egp(100) }, { condition: "New", LandedPrice: egp(300) }] },
      Offers: [{ MyOffer: false, IsBuyBoxWinner: true, ListingPrice: egp(300) }],
    });
    expect(s).toMatchObject({ myPrice: null, buyBoxPrice: 300, isWinner: false, offerCount: 1 });
  });
});
