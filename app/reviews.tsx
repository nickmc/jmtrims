import { getGoogleReviews } from "@/lib/reviews";

export default async function Reviews() {
  const reviews = await getGoogleReviews();
  if (!reviews || reviews.length === 0) return null;

  return (
    <section
      id="reviews"
      className="flex scroll-mt-16 flex-col items-center justify-center gap-6 px-6 py-12"
    >
      <p className="text-2xl">What customers say</p>
      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {reviews.slice(0, 3).map((review, i) => (
          <div key={i} className="rounded-xl bg-white/60 p-5">
            <div className="text-amber-600" aria-hidden="true">
              {"★".repeat(review.rating)}
            </div>
            <p className="mt-2 text-sm">{review.text}</p>
            <p className="mt-3 text-sm font-medium">{review.authorName}</p>
          </div>
        ))}
      </div>
      <p className="text-xs opacity-60">Reviews via Google</p>
    </section>
  );
}
