import type { PublicSettings } from "@/lib/settings/public";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** One line per part, as written on an envelope; the country by name. */
export function addressLines(address: NonNullable<PublicSettings["address"]>): string[] {
  const town = [address.locality, address.region, address.postcode].filter(Boolean).join(", ");
  return [address.street, town, regionNames.of(address.country) ?? address.country].filter((l): l is string => Boolean(l));
}

/**
 * Phone numbers and the postal address saved in the admin. Renders nothing until CALIX supplies
 * them: there is no public placeholder for these (docs/content-gaps.md).
 */
export function ContactLines({ settings, className = "" }: { settings: PublicSettings; className?: string }) {
  const { phones, address } = settings;
  if (!phones.length && !address) return null;
  return (
    <div className={className}>
      {phones.map((p) => (
        <p key={p.e164}>
          {p.label ? `${p.label}: ` : "Phone: "}
          <a href={`tel:${p.e164}`}>{p.display}</a>
        </p>
      ))}
      {address ? (
        <address className="not-italic">
          {addressLines(address).map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </address>
      ) : null}
    </div>
  );
}
