export type GoogleReview = {
  authorName: string;
  rating: number;
  text: string;
};

type PlacesApiReview = {
  rating?: number;
  text?: { text?: string };
  authorAttribution?: { displayName?: string };
};

const PLACE_ID = process.env.GOOGLE_PLACE_ID;
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

// Reviews change rarely, and Google's Places API is metered per request, so
// this holds the last fetch for an hour rather than hitting it on every page
// load.
const REVIEWS_CACHE_MS = 60 * 60 * 1000;
let cache: { expiresAt: number; value: GoogleReview[] | null } | null = null;

// Returns the shop's Google reviews, or null if the Places API isn't
// configured (no key/place ID yet) or the request fails — callers should
// treat null the same as "no reviews to show" rather than an error, since a
// review section is optional decoration, not core site function.
export async function getGoogleReviews(): Promise<GoogleReview[] | null> {
  if (!PLACE_ID || !API_KEY) return null;
  if (cache && cache.expiresAt > Date.now()) return cache.value;

  let value: GoogleReview[] | null = null;

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${PLACE_ID}`,
      {
        headers: {
          "X-Goog-Api-Key": API_KEY,
          "X-Goog-FieldMask": "reviews",
        },
      }
    );

    if (res.ok) {
      const data = (await res.json()) as { reviews?: PlacesApiReview[] };
      value = (data.reviews ?? [])
        .filter((r) => r.text?.text && r.rating)
        .map((r) => ({
          authorName: r.authorAttribution?.displayName || "Customer",
          rating: r.rating!,
          text: r.text!.text!,
        }));
    } else {
      console.error("Failed to fetch Google reviews:", res.status, await res.text());
    }
  } catch (error) {
    console.error("Failed to fetch Google reviews:", error);
  }

  cache = { expiresAt: Date.now() + REVIEWS_CACHE_MS, value };
  return value;
}
