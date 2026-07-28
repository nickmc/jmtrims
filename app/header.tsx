"use client";

import InstagramIcon from "./instagram-icon";
import { SECTION_IDS } from "./sections";

function scrollToNextSection() {
  const sections = SECTION_IDS.map((id) => document.getElementById(id)).filter(
    (el): el is HTMLElement => el !== null
  );

  if (sections.length === 0) return;

  const scrollPosition = window.scrollY + 10;
  const next = sections.find((el) => el.offsetTop > scrollPosition);
  const target = next ?? sections[0];

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Header() {
  return (
    <header className="sticky top-0 z-50 flex items-center justify-between bg-[#0a1e4d] px-4 py-3">
      <button
        type="button"
        aria-label="Scroll to next section"
        onClick={scrollToNextSection}
        className="text-white"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <a
        href="https://www.instagram.com/jmtrims__"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="JM Trims on Instagram"
        className="text-white transition-opacity hover:opacity-70"
      >
        <InstagramIcon width={26} height={26} />
      </a>
    </header>
  );
}
