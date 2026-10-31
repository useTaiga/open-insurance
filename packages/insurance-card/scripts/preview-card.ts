import { createApplePassJson } from "../src/index";
import type { IssuedCard, WalletIssuer } from "../src/index";

const esc = (value: string) => Bun.escapeHTML(value);

export const renderCardPreview = (
  card: IssuedCard,
  issuer: WalletIssuer,
  logo?: Buffer
): string => {
  const pass = createApplePassJson(card, issuer);
  const patient = card.insurance.dependents?.[0] ?? card.insurance.subscriber;
  const member = esc(
    [patient.firstName, patient.lastName].filter(Boolean).join(" ") || "Member"
  );
  const subscriber = esc(
    [card.insurance.subscriber.firstName, card.insurance.subscriber.lastName]
      .filter(Boolean)
      .join(" ") || "See issuer"
  );
  const headingX = logo === undefined ? 54 : 188;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="660" viewBox="0 0 1000 660">
<rect width="1000" height="660" rx="42" fill="${pass.backgroundColor}"/>
<g font-family="Arial, sans-serif" fill="${pass.foregroundColor}">
${logo === undefined ? "" : `<image x="48" y="40" width="108" height="108" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${logo.toString("base64")}"/>`}
<text x="${headingX}" y="84" font-size="${issuer.organizationName.length > 24 ? 31 : 42}" font-weight="700">${esc(issuer.organizationName)}</text>
<text x="${headingX}" y="121" font-size="15" letter-spacing="2" opacity=".8">WALLET INSURANCE CARD</text>
${issuer.demo === true ? `<rect x="826" y="52" width="120" height="42" rx="21" fill="white" fill-opacity=".16"/><text x="886" y="79" text-anchor="middle" font-size="16" letter-spacing="2" font-weight="700">DEMO</text>` : ""}
<path d="M54 178H946" stroke="white" stroke-opacity=".22"/>
<text x="54" y="225" font-size="15" letter-spacing="2" opacity=".8">${issuer.demo === true ? "FICTIONAL MEMBER" : "MEMBER"}</text>
<text x="54" y="283" font-size="51" font-weight="600">${member}</text>
<text x="54" y="351" font-size="15" letter-spacing="2" opacity=".8">MEMBER ID</text>
<text x="54" y="391" font-size="29">${esc(card.insurance.subscriber.memberId ?? "See issuer")}</text>
<text x="650" y="351" font-size="15" letter-spacing="2" opacity=".8">GROUP</text>
<text x="650" y="391" font-size="29">${esc(card.insurance.subscriber.groupNumber ?? "See issuer")}</text>
<text x="54" y="464" font-size="15" letter-spacing="2" opacity=".8">POLICYHOLDER</text>
<text x="54" y="503" font-size="27">${subscriber}</text>
<text x="946" y="503" text-anchor="end" font-size="18" opacity=".8">${(card.insurance.dependents?.length ?? 0) > 0 ? "Dependent example" : "Subscriber example"}</text>
<path d="M54 555H946" stroke="white" stroke-opacity=".22"/>
<text x="54" y="603" font-size="15" letter-spacing="1" opacity=".85">${issuer.demo === true ? `FICTIONAL PROTOTYPE · ${pass.nfc === undefined ? "NFC OFF" : "NFC CONFIGURED"}` : "DESIGN PREVIEW · NOT AN ISSUED CARD"}</text>
<text x="946" y="603" text-anchor="end" font-size="17" opacity=".85">${issuer.demo === true ? "Open Insurance by Taiga" : "Wallet layout may vary"}</text>
</g></svg>`;
};
