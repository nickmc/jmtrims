import BookingCalendar from "./book/BookingCalendar";
import InstagramIcon from "./instagram-icon";
import { SECTION_IDS } from "./sections";

export default function Home() {
  return (
    <>
      <section
        id={SECTION_IDS[0]}
        className="flex min-h-screen scroll-mt-16 flex-col items-center justify-center gap-8 px-6 py-12"
      >
        <p className="text-5xl text-center">coming soon JMTrims</p>

        <div className="flex flex-wrap items-center justify-center gap-6">
          <video
            className="w-48 rounded-lg shadow-lg sm:w-56"
            src="/videos/clip-1.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
          <video
            className="w-48 rounded-lg shadow-lg sm:w-56"
            src="/videos/clip-2.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
        </div>
      </section>

      <section
        id={SECTION_IDS[1]}
        className="flex min-h-screen scroll-mt-16 flex-col items-center justify-center gap-8 px-6 py-12"
      >
        <BookingCalendar />
      </section>

      <section
        id={SECTION_IDS[2]}
        className="flex min-h-screen scroll-mt-16 flex-col items-center justify-center gap-4 px-6 py-12"
      >
        <p className="text-2xl">Contact</p>
        <a
          href="https://www.instagram.com/jmtrims__"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-2 text-current transition-opacity hover:opacity-70"
        >
          <InstagramIcon width={32} height={32} />
          <span className="text-sm">Message us on Instagram</span>
        </a>
      </section>
    </>
  );
}
