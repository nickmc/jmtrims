"use client";

import { useState } from "react";
import InstagramIcon from "./instagram-icon";
import { SECTION_IDS } from "./sections";

const SECTION_LABELS: Record<(typeof SECTION_IDS)[number], string> = {
  gallery: "Gallery",
  booking: "Book an appointment",
  contact: "Contact",
};

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between bg-[#0a1e4d] px-4 py-3">
      <div className="relative">
        <button
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="text-[#f5f0e1]"
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

        {menuOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              tabIndex={-1}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <div className="absolute top-full left-0 z-50 mt-2 flex w-56 flex-col overflow-hidden rounded-md border border-[#f5f0e1]/20 bg-[#0a1e4d] shadow-lg">
              {SECTION_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    scrollToSection(id);
                    setMenuOpen(false);
                  }}
                  className="px-4 py-3 text-left text-[#f5f0e1] hover:bg-white/10"
                >
                  {SECTION_LABELS[id]}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <p
        className="text-3xl font-medium tracking-wide text-[#f5f0e1] uppercase"
        style={{ fontFamily: "var(--font-oswald)" }}
      >
        JM Trims
      </p>

      <a
        href="https://www.instagram.com/jmtrims__"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="JM Trims on Instagram"
        className="text-[#f5f0e1] transition-opacity hover:opacity-70"
      >
        <InstagramIcon width={26} height={26} />
      </a>
    </header>
  );
}
