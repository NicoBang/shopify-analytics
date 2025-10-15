For at få værdien af en ordrelinje (line item) fratrukket moms og rabatter via Shopify Admin GraphQL API, skal du bruge felterne på LineItem-objektet for ordrer. Shopify gemmer ikke direkte "netto uden moms og rabat" som ét felt, men du kan beregne det ud fra de tilgængelige felter.

Sådan gør du for ordrer
Hent line items med relevante felter:

originalUnitPriceSet: Pris pr. stk. før rabat og moms.
discountedUnitPriceSet: Pris pr. stk. efter rabat, men før moms.
taxLines: Indeholder moms pr. line item.
Eksempel på GraphQL-query:

Operation
Open in GraphiQL
Copy
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
{
  order(id: "gid://shopify/Order/123456789") {
    lineItems(first: 10) {
      edges {
        node {
          name
          quantity
          originalUnitPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          discountedUnitPriceSet {
            shopMoney {
              amount
              currencyCode
            }
          }
          taxLines {
            priceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
}
discountedUnitPriceSet.shopMoney.amount er prisen pr. stk. efter rabat, men før moms.
For at få totalen for en line item uden moms og rabat:
discountedUnitPriceSet.shopMoney.amount * quantity
Hvis du vil trække momsen fra, kan du bruge taxLines.priceSet.shopMoney.amount til at se, hvor meget moms der er pålagt.
Bemærk
Hvis du arbejder med draft orders, kan du bruge felter som discountedTotalSet og originalTotalSet på CalculatedDraftOrderLineItem for at få totaler før og efter rabat, og trække moms fra via taxLines.
Shopify kan vise priser inkl. eller ekskl. moms afhængigt af shop-indstillingerne (taxesIncluded).
Dokumentation
Order object
LineItem object
Hvis du har brug for at beregne værdien helt ekskl. moms og rabatter, skal du bruge discountedUnitPriceSet og trække momsen fra, som vist ovenfor.