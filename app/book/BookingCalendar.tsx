"use client";

import { useEffect, useState, useTransition } from "react";
import { isOpenDay } from "@/lib/booking";
import { createBooking, getAvailability, type SlotAvailability } from "./actions";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// How often to re-check the clock: rolls the calendar onto the new day at
// midnight, and keeps past-slot greying accurate without a manual refresh.
const REFRESH_INTERVAL_MS = 60_000;

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function upcomingDates(count: number): string[] {
  const start = todayStr();
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}

function describeDate(dateStr: string) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return {
    weekday: WEEKDAY_LABELS[d.getUTCDay()],
    day: d.getUTCDate(),
    month: MONTH_LABELS[d.getUTCMonth()],
  };
}

export default function BookingCalendar() {
  const [date, setDate] = useState(todayStr());
  const [dayOpen, setDayOpen] = useState<boolean | null>(null);
  const [slots, setSlots] = useState<SlotAvailability[]>([]);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Tick every minute so the day-chip row and date picker's `min` (both of
  // which read the real clock on every render) roll forward on their own,
  // and so today's slots keep re-checking availability as the day goes on.
  useEffect(() => {
    const interval = setInterval(() => {
      const t = todayStr();
      if (date < t) {
        setDate(t);
        setSelectedTime(null);
        setStatus("idle");
      }
      setRefreshTick((tick) => tick + 1);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [date]);

  useEffect(() => {
    startTransition(async () => {
      const result = await getAvailability(date);
      setDayOpen(result.open);
      setSlots(result.slots);
    });
  }, [date, refreshTick]);

  function selectDate(nextDate: string) {
    setSelectedTime(null);
    setStatus("idle");
    setDate(nextDate);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTime) return;

    startTransition(async () => {
      const result = await createBooking({
        date,
        time: selectedTime,
        name,
        phone,
        location,
      });

      if (result.ok) {
        setStatus("success");
        setSlots((prev) =>
          prev.map((slot) =>
            slot.time === selectedTime ? { ...slot, available: false } : slot
          )
        );
        setSelectedTime(null);
        setName("");
        setPhone("");
        setLocation("");
      } else {
        setStatus("error");
        setErrorMessage(result.error);
      }
    });
  }

  const selected = describeDate(date);

  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-6 rounded-2xl bg-white/30 p-6 sm:p-10">
      <p className="text-3xl">Book an appointment</p>

      <div className="flex flex-col items-center gap-1">
        <div className="flex flex-wrap justify-center gap-4 text-sm font-medium">
          <span>Haircut — £15</span>
          <span>Scissor cut — £20</span>
        </div>
        <p className="text-xs">Payment is taken in person</p>
      </div>

      <div className="flex w-full flex-wrap justify-center gap-3">
        {upcomingDates(10).map((d) => {
          const { weekday, day } = describeDate(d);
          const open = isOpenDay(d);
          const isSelected = d === date;
          return (
            <button
              key={d}
              type="button"
              disabled={!open}
              onClick={() => selectDate(d)}
              aria-label={`${weekday} ${day}${!open ? ", closed" : ""}`}
              className={`flex min-w-16 flex-col items-center gap-0.5 rounded-md border px-3 py-2 ${
                isSelected
                  ? "border-black bg-black/10"
                  : "border-black/30 bg-white/70"
              } ${
                !open
                  ? "cursor-not-allowed opacity-30"
                  : "hover:bg-black/10"
              }`}
            >
              <span className="text-xs">{weekday}</span>
              <span className="text-lg font-medium">{day}</span>
            </button>
          );
        })}
      </div>

      <label className="flex flex-col items-center gap-1 text-xs">
        <span>Looking further ahead? Pick a date</span>
        <input
          type="date"
          value={date}
          min={todayStr()}
          onChange={(e) => selectDate(e.target.value)}
          className="rounded-md border border-black/20 bg-white/80 px-3 py-2 text-sm text-black"
        />
      </label>

      <p className="text-base font-medium">
        {selected.weekday} {selected.day} {selected.month}
      </p>

      {dayOpen === false && (
        <p className="text-sm">Closed that day — please pick another date.</p>
      )}

      {dayOpen && (
        <div className="flex flex-wrap justify-center gap-3">
          {slots
            .filter((slot) => slot.time !== selectedTime)
            .map((slot) => (
              <button
                key={slot.time}
                type="button"
                disabled={!slot.available}
                onClick={() => setSelectedTime(slot.time)}
                className={`rounded-md border px-4 py-2 text-base ${
                  slot.available
                    ? "border-black/30 bg-white/60 hover:bg-black/10"
                    : "cursor-not-allowed border-black/30 bg-white/60 opacity-30"
                }`}
              >
                {slot.time}
              </button>
            ))}
        </div>
      )}

      {selectedTime && (
        <form
          onSubmit={handleSubmit}
          className="flex w-full max-w-xl flex-col gap-3 rounded-md bg-white/80 p-6 text-black"
        >
          <p className="text-base font-medium">
            {selected.weekday} {selected.day} {selected.month} at {selectedTime}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input
              required
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded border border-black/20 px-3 py-2"
            />
            <input
              required
              type="tel"
              placeholder="Phone number, e.g. 07123 456789"
              pattern="^[\d\s().+-]{10,15}$"
              title="Enter a valid UK phone number, e.g. 07123 456789"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded border border-black/20 px-3 py-2"
            />
            <input
              required
              placeholder="Location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="rounded border border-black/20 px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="mt-1 rounded bg-black px-4 py-2.5 text-white disabled:opacity-50"
          >
            {isPending ? "Booking…" : "Confirm booking"}
          </button>
        </form>
      )}

      {status === "success" && (
        <p className="text-sm">Booked! We&apos;ll see you then.</p>
      )}
      {status === "error" && <p className="text-sm text-red-900">{errorMessage}</p>}
    </div>
  );
}
