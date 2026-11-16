import Image from "next/image";
import Link from "next/link";
import { getPublicSettings } from "@/lib/settings/public";
import { primaryCta } from "@/content/site";
import { services } from "@/content/services";
import { collaboration, processSteps } from "@/content/process";
import { featuredProjects, workGateMet } from "@/content/work";
import { ContentPlaceholder, Fact } from "@/components/ui/Pending";

/**
 * The home page as the seven-chapter scroll story (docs/scroll-story-build-plan.md):
 * 01 Origin · 02 Awakening · 03 Foundation · 04 Services · 05 Work · 06 Identity · 07 Ecosystem,
 * then "How we work together" and the enquiry band (FinalCta).
 *
 * Everything here is server-rendered and readable without motion: each chapter is a normal
 * section with its still. When motion is on, components/home/story/engine plays all seven chapters
 * inside one pinned stage (`data-cx-stage`), animating this same text through its data attributes
 * (`.tl[data-in][data-out]`, in scroll units; `data-cx-rest` is each chapter's resting point) and
 * drawing the world on the canvas. `.cx-motion-only` elements exist only for the motion layout;
 * `.cx-static-only` elements only for the static one.
 */

const sizes = "(min-width: 900px) 460px, calc(100vw - 40px)";
const f2 = (a: number, b: number) => `${a.toFixed(2)} ${b.toFixed(2)}`;
const SHORT = ["Brand", "Web", "Marketing", "SEO & GEO", "Growth"];
const RAIL = [
  ["01", "Origin", "0"],
  ["02", "Awakening", "1.78"],
  ["03", "Foundation", "3.95"],
  ["04", "Services", "4.85"],
  ["05", "Work", "8.25"],
  ["06", "Identity", "9.8"],
  ["07", "Ecosystem", "11.1"],
];

export async function Chapters() {
  const { replyTime } = await getPublicSettings();
  const projects = workGateMet ? featuredProjects.slice(0, 3) : [];
  return (
    <div className="cx surface-inverse" data-cx>
      {/* Loading screen: the chapter 06 logo, shown only in motion mode while the story engine
          loads (app/cinema.css). Decorative: the page beneath stays in the accessibility tree. */}
      <div className="cx-loader" aria-hidden="true">
        {/* Unoptimised on purpose: the sheen in app/cinema.css masks with this same file, so the
            browser downloads it once. */}
        <div className="cx-loader__mark">
          <Image src="/brand/calix-primary-reversed.png" alt="" width={953} height={1084} unoptimized loading="eager" />
        </div>
      </div>
      {/* The track gives the story its scroll length; the stage inside it is held in view by CSS
          (position: sticky), so the browser itself keeps it still while scrolling. */}
      <div className="cx-track" data-cx-track>
      <div className="cx-stage" data-cx-stage>
        <canvas className="cx-canvas" data-cx-canvas aria-hidden="true" />
        <div className="cx-grain" data-cx-grain aria-hidden="true" />

        {/* 01 Origin: the headline is visible on first paint and never gated by the motion. */}
        <section className="cx-ch cx-ch1" data-cx-rest="0" aria-labelledby="hero-title">
          <div className="cx-col">
            <div className="cx-copy">
              <p className="cx-kicker tl" data-out="0.20 0.40">
                <span>
                  <b>01</b> Origin
                </span>
              </p>
              <h1 id="hero-title" className="cx-display">
                <span className="tl" data-out="0.24 0.44">
                  <span>Make Your Brand</span>
                </span>{" "}
                <span className="tl" data-out="0.27 0.47">
                  <span>Impossible</span>
                </span>{" "}
                <span className="tl" data-out="0.30 0.50">
                  <span>to Ignore.</span>
                </span>
              </h1>
              <p className="cx-lead tl tl--fade" data-out="0.30 0.48">
                <span>Strategy, design, technology and marketing — connected to build stronger brands and better digital outcomes.</span>
              </p>
              <div className="cx-actions tl tl--fade" data-out="0.33 0.50">
                <span>
                  <Link href={primaryCta.href} className="btn btn-primary cx-btn-light" data-cta="hero">
                    {primaryCta.label}
                  </Link>
                  <a href="#work" className="btn btn-secondary">
                    Explore Our Work
                  </a>
                </span>
              </div>
              <Fact
                value={replyTime}
                render={(v) => (
                  <p className="cx-note tl tl--fade" data-out="0.33 0.50">
                    <span>We reply within {v}.</span>
                  </p>
                )}
              />
              <p className="cx-caption tl tl--fade" data-out="0.18 0.36">
                <span>An idea appears — a single point of light in a quiet space.</span>
              </p>
            </div>
          </div>
          <figure className="cx-still">
            <Image src="/cinema/scene-01.webp" alt="" width={1080} height={1805} quality={85} sizes={sizes} />
          </figure>
        </section>

        {/* 02 Awakening */}
        <section className="cx-ch cx-ch2" data-cx-rest="1.78" aria-labelledby="awakening-title">
          <div className="cx-col">
            <div className="cx-copy">
              <p className="cx-kicker tl" data-in="1.50 1.64" data-out="2.24 2.40">
                <span>
                  <b>02</b> Awakening
                </span>
              </p>
              <h2 id="awakening-title" className="cx-title">
                <span className="tl" data-in="1.54 1.70" data-out="2.22 2.38">
                  <span>The idea</span>
                </span>{" "}
                <span className="tl" data-in="1.58 1.74" data-out="2.24 2.40">
                  <span>starts to move.</span>
                </span>
              </h2>
              <p className="cx-body tl tl--fade" data-in="1.68 1.86" data-out="2.18 2.34">
                <span>
                  Most brands are built in pieces: a logo from one studio, a website from another, campaigns and search from
                  someone else. We plan them as one line of thought.
                </span>
              </p>
              <p className="cx-caption tl tl--fade" data-in="1.76 1.92" data-out="2.16 2.32">
                <span>The idea creates movement, finding energy in unexpected places.</span>
              </p>
            </div>
          </div>
          <figure className="cx-still">
            <Image src="/cinema/awakening-veins-full.webp" alt="" width={2048} height={2048} quality={85} sizes={sizes} />
          </figure>
        </section>

        {/* 03 Foundation: the process steps appear as the roots reach them. */}
        <section className="cx-ch cx-ch3" id="process" data-cx-rest="3.95" aria-labelledby="process-title">
          <div className="cx-col">
            <div className="cx-copy" data-cx-card="2.82 2.96 4.36 4.48">
              <p className="cx-kicker tl" data-in="2.82 2.96" data-out="4.34 4.44">
                <span>
                  <b>03</b> Foundation
                </span>
              </p>
              <h2 id="process-title" className="cx-title">
                <span className="tl" data-in="2.86 3.02" data-out="4.34 4.44">
                  <span>One line of thought,</span>
                </span>{" "}
                <span className="tl" data-in="2.90 3.06" data-out="4.36 4.46">
                  <span>from position to enquiry.</span>
                </span>
              </h2>
            </div>
            <ol className="cx-steps">
              {processSteps.map((step, i) => (
                <li key={step.title} data-cx-step>
                  <h3>
                    <span aria-hidden="true">{i + 1}</span> {step.title}
                  </h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
            <p className="cx-teaser cx-caption cx-motion-only tl tl--fade" data-in="4.12 4.30" data-out="4.36 4.48">
              <span>Five services rise from this line.</span>
            </p>
          </div>
          <figure className="cx-still">
            <Image src="/cinema/foundation-ground.webp" alt="" width={1671} height={941} quality={85} sizes={sizes} />
          </figure>
        </section>

        {/* 04 Services: each service rises from its point on the ground line into a window of light. */}
        <section className="cx-ch cx-ch4" id="services" data-cx-rest="4.85" aria-labelledby="services-title">
          <div className="cx-col">
            <div className="cx-copy">
              <p className="cx-kicker tl" data-in="4.49 4.60" data-out="7.26 7.38">
                <span>
                  <b>04</b> Services
                </span>
              </p>
              <h2 id="services-title" className="cx-title">
                <span className="tl" data-in="4.51 4.63" data-out="7.24 7.36">
                  <span>Five services,</span>
                </span>{" "}
                <span className="tl" data-in="4.54 4.66" data-out="7.26 7.38">
                  <span>planned together.</span>
                </span>
              </h2>
            </div>
            <div className="cx-services">
              {services.map((s, j) => {
                const st = 4.6 + j * 0.55, i0 = st + 0.08, o0 = j === 4 ? 7.26 : st + 0.52;
                return (
                  <div key={s.key} className="cx-service" id={s.anchor} data-cx-rest={(st + 0.35).toFixed(2)}>
                    <p className="cx-service__n tl" data-in={f2(i0, i0 + 0.1)} data-out={f2(o0, o0 + 0.08)}>
                      <span>{String(j + 1).padStart(2, "0")} / 05</span>
                    </p>
                    <h3 className="cx-service__name tl" data-in={f2(i0 + 0.02, i0 + 0.12)} data-out={f2(o0, o0 + 0.08)}>
                      <span>{s.name}</span>
                    </h3>
                    <p className="cx-caption tl tl--fade" data-in={f2(i0 + 0.05, i0 + 0.15)} data-out={f2(o0 - 0.02, o0 + 0.06)}>
                      <span>{s.heading}</span>
                    </p>
                    <p className="cx-note cx-service__desc tl tl--fade" data-in={f2(i0 + 0.07, i0 + 0.17)} data-out={f2(o0 - 0.02, o0 + 0.06)}>
                      <span>{s.descriptor}</span>
                    </p>
                    <p className="tl tl--fade" data-in={f2(i0 + 0.08, i0 + 0.18)} data-out={f2(o0 - 0.02, o0 + 0.06)}>
                      <span>
                        <Link href={`/services/${s.slug}`} className="link">
                          See {s.name}
                        </Link>
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="cx-pts cx-motion-only" aria-hidden="true" data-cx-pts>
              {SHORT.map((name, j) => (
                <span key={name}>
                  <b>{String(j + 1).padStart(2, "0")}</b>
                  <i> {name}</i>
                </span>
              ))}
            </div>
            <p className="cx-illus cx-motion-only" data-cx-illus>
              Illustration, not client work
            </p>
          </div>
          <figure className="cx-still">
            <Image src="/cinema/service-brand-stone.webp" alt="" width={1086} height={1448} quality={85} sizes={sizes} />
          </figure>
        </section>

        {/* 05 Work: three luminous forms. Only approved projects are ever shown. */}
        <section className="cx-ch cx-ch5" id="work" data-cx-rest="8.25" aria-labelledby="work-title">
          <div className="cx-col">
            <div className="cx-copy">
              <p className="cx-kicker tl" data-in="7.55 7.68" data-out="8.62 8.76">
                <span>
                  <b>05</b> Work
                </span>
              </p>
              <h2 id="work-title" className="cx-title">
                <span className="tl" data-in="7.58 7.72" data-out="8.60 8.74">
                  <span>Selected work</span>
                </span>
              </h2>
              <p className="cx-body tl tl--fade" data-in="7.66 7.80" data-out="8.58 8.72">
                <span>
                  {projects.length > 0
                    ? "Client projects shown here are published only with the client's approval, with the facts they have confirmed."
                    : "Our client case studies are being prepared with each client's approval, so we only show what they have confirmed. If you would like to see work relevant to your project, ask us when you get in touch."}
                </span>
              </p>
              <p className="tl tl--fade" data-in="7.70 7.84" data-out="8.58 8.72">
                <span>
                  {projects.length > 0 ? (
                    <Link href="/work" className="link font-medium">
                      See all work
                    </Link>
                  ) : (
                    <Link href="/contact" className="link font-medium" data-cta="work-gap">
                      Ask about relevant work
                    </Link>
                  )}
                </span>
              </p>
            </div>
            <ul className="cx-slots">
              {[0, 1, 2].map((k) => {
                const p = projects[k];
                return (
                  <li
                    key={k}
                    className={`cx-slot tl tl--fade${p ? "" : " cx-motion-only"}`}
                    data-cx-slot={k}
                    data-in={f2(8 + k * 0.06, 8.1 + k * 0.06)}
                    data-out={f2(8.56 + k * 0.02, 8.68 + k * 0.02)}
                  >
                    <span>
                      {p ? (
                        <Link href={`/work/${p.slug}`} className="link">
                          {p.title}
                        </Link>
                      ) : (
                        <>Project {String(k + 1).padStart(2, "0")} · awaiting an approved project</>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            {projects.length === 0 ? (
              <div className="cx-static-only">
                <ContentPlaceholder
                  title="Featured client projects"
                  needed={[
                    "Two to three approved projects (publication level P1 or P2)",
                    "Desktop and mobile screenshots, identity files or campaign assets for each",
                    "Services delivered, year, and the project objective",
                    "Written publication approval reference for each client",
                  ]}
                >
                  No client work is shown until approved projects are supplied.
                </ContentPlaceholder>
              </div>
            ) : null}
          </div>
        </section>

        {/* 06 Identity: the forms converge; the light recedes and the real logo appears on calm ground. */}
        <section className="cx-ch cx-ch6" id="credibility" data-cx-rest="9.80" aria-labelledby="credibility-title">
          <figure className="cx-logo" data-cx-logo>
            <Image src="/brand/calix-primary-reversed.png" alt="CALIX" width={953} height={1084} sizes="(min-width: 760px) 420px, 300px" />
          </figure>
          <div className="cx-col">
            <div className="cx-copy">
              <p className="cx-kicker tl" data-in="9.50 9.62" data-out="9.95 10.07">
                <span>
                  <b>06</b> Identity
                </span>
              </p>
              <h2 id="credibility-title" className="cx-title">
                <span className="tl" data-in="9.54 9.68" data-out="9.94 10.06">
                  <span>Proof, with its sources.</span>
                </span>
              </h2>
              <p className="cx-body tl tl--fade" data-in="9.60 9.74" data-out="9.93 10.05">
                <span>We would rather show less than claim more. Every result we publish meets three rules:</span>
              </p>
              <ul className="cx-list">
                <li className="tl tl--fade" data-in="9.64 9.78" data-out="9.93 10.05">
                  <span>Published only with the client&apos;s written approval.</span>
                </li>
                <li className="tl tl--fade" data-in="9.67 9.81" data-out="9.93 10.05">
                  <span>Stated with a baseline, a time period and a data source.</span>
                </li>
                <li className="tl tl--fade" data-in="9.70 9.84" data-out="9.93 10.05">
                  <span>Concept work is always labelled as concept, never as client work.</span>
                </li>
              </ul>
            </div>
            <div className="cx-static-only">
              <ContentPlaceholder
                title="Verified client outcomes"
                needed={["Approved outcome figures with baseline, time period and source", "Client approval to publish each figure"]}
              />
              <ContentPlaceholder
                title="Client testimonial"
                needed={["A client quote in the client's exact words", "Name, role and company as approved", "Written permission to publish"]}
              />
            </div>
          </div>
        </section>

        {/* 07 Ecosystem: everything connects; the enquiry band follows when the story releases. */}
        <section className="cx-ch cx-ch7" data-cx-rest="11.10" aria-labelledby="ecosystem-title">
          <div className="cx-col">
            <div className="cx-copy">
              <p className="cx-kicker tl" data-in="10.72 10.85">
                <span>
                  <b>07</b> Ecosystem
                </span>
              </p>
              <h2 id="ecosystem-title" className="cx-title">
                <span className="tl" data-in="10.76 10.90">
                  <span>Everything connects.</span>
                </span>
              </h2>
              <p className="cx-body tl tl--fade" data-in="10.84 10.98">
                <span>Brand, identity, website, marketing and search, planned as one line of thought.</span>
              </p>
              <p className="cx-caption tl tl--fade" data-in="10.88 11.02">
                <span>A complete identity, always evolving.</span>
              </p>
              <div className="cx-actions tl tl--fade" data-in="10.92 11.06">
                <span>
                  <Link href={primaryCta.href} className="btn btn-primary cx-btn-light" data-cta="story-end">
                    {primaryCta.label}
                  </Link>
                </span>
              </div>
            </div>
          </div>
          <figure className="cx-still">
            <Image src="/cinema/scene-10.webp" alt="" width={1080} height={1805} quality={85} sizes={sizes} />
          </figure>
        </section>

        <nav className="cx-rail" data-cx-rail aria-label="Story chapters">
          {RAIL.map(([n, name, u]) => (
            <button key={n} type="button" data-u={u}>
              <b>{n}</b> <span>{name}</span>
            </button>
          ))}
          <i className="cx-rail__bar" data-cx-rail-bar aria-hidden="true" />
        </nav>
      </div>
      </div>

      {/* How we work together: in normal flow after the story. */}
      <section className="cx-band" aria-labelledby="together-title">
        <h2 id="together-title" className="cx-subhead">
          How we work together
        </h2>
        <ul className="cx-list">
          {collaboration.map((item) => (
            <li key={item.title}>
              <span className="font-medium">{item.title}.</span> {item.body}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
