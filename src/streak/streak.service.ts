/**
 * StreakService
 *
 * Rules:
 * - "touch" = record that the user was active today
 * - If last_active_on = yesterday  → increment current_count, update longest if needed
 * - If last_active_on = today      → no change (already counted)
 * - If last_active_on < yesterday  → reset current_count to 1 (streak broken)
 * - Silent Mode unlocks at current_count >= 7
 */
import { Injectable } from '@nestjs/common';
import { DataSource }  from 'typeorm';

export interface StreakData {
  currentCount:    number;
  longestCount:    number;
  lastActiveOn:    string | null;   // ISO date YYYY-MM-DD
  silentModeReady: boolean;          // true when currentCount >= 7
  daysThisWeek:    { label: string; done: boolean }[];
  touchedToday:    boolean;
  isNewRecord:     boolean;          // true if currentCount just beat longestCount
}

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

@Injectable()
export class StreakService {
  constructor(private readonly ds: DataSource) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private yesterday(): string {
    return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  }

  /** Build a 7-element array Mon→Sun showing which days user was active this week */
  private buildWeekDots(lastActiveOn: string | null, currentCount: number): { label: string; done: boolean }[] {
    const today     = new Date();
    const todayIso  = today.toISOString().slice(0, 10);

    return Array.from({ length: 7 }, (_, i) => {
      // i=0 Mon, i=6 Sun — shift to local week starting Monday
      const dayOfWeek = today.getDay(); // 0=Sun,1=Mon…
      const mondayOffset = (dayOfWeek + 6) % 7; // days since Monday
      const d = new Date(today.getTime() - (mondayOffset - i) * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      const label = DAY_LABELS[d.getDay()];

      // A day is "done" if it's within the current streak window going backwards from today
      let done = false;
      if (lastActiveOn && lastActiveOn >= iso) {
        // Count backwards: if iso >= (lastActiveOn - currentCount days + 1) it's in streak
        const streakStart = new Date(
          new Date(lastActiveOn).getTime() - (currentCount - 1) * 86_400_000,
        ).toISOString().slice(0, 10);
        done = iso >= streakStart && iso <= lastActiveOn;
      }

      return { label, done };
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getStreak(userId: string): Promise<StreakData> {
    const rows = await this.ds.query<{
      current_count: number; longest_count: number; last_active_on: string | null;
    }[]>(
      `SELECT current_count, longest_count, last_active_on::text
       FROM streaks WHERE user_id = $1`,
      [userId],
    );

    if (!rows.length) {
      // Provision if missing (shouldn't happen after register, but safety net)
      await this.ds.query(
        `INSERT INTO streaks (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [userId],
      );
      return this.buildResult(0, 0, null);
    }

    const { current_count, longest_count, last_active_on } = rows[0];
    return this.buildResult(current_count, longest_count, last_active_on);
  }

  /** Call this when the user opens the app / logs in. Idempotent for same day. */
  async touchStreak(userId: string): Promise<StreakData> {
    const today     = this.today();
    const yesterday = this.yesterday();

    const rows = await this.ds.query<{
      current_count: number; longest_count: number; last_active_on: string | null;
    }[]>(
      `SELECT current_count, longest_count, last_active_on::text
       FROM streaks WHERE user_id = $1`,
      [userId],
    );

    // Ensure row exists
    if (!rows.length) {
      await this.ds.query(
        `INSERT INTO streaks (user_id, current_count, longest_count, last_active_on)
         VALUES ($1, 1, 1, $2) ON CONFLICT DO NOTHING`,
        [userId, today],
      );
      return this.buildResult(1, 1, today);
    }

    const { current_count, longest_count, last_active_on } = rows[0];

    // Already touched today — no change
    if (last_active_on === today) {
      return this.buildResult(current_count, longest_count, last_active_on);
    }

    let newCount: number;
    if (last_active_on === yesterday) {
      // Consecutive day — extend streak
      newCount = current_count + 1;
    } else {
      // Gap > 1 day — reset
      newCount = 1;
    }

    const newLongest = Math.max(newCount, longest_count);

    await this.ds.query(
      `UPDATE streaks
       SET current_count = $1, longest_count = $2, last_active_on = $3, updated_at = NOW()
       WHERE user_id = $4`,
      [newCount, newLongest, today, userId],
    );

    return this.buildResult(newCount, newLongest, today);
  }

  private buildResult(
    currentCount:  number,
    longestCount:  number,
    lastActiveOn:  string | null,
  ): StreakData {
    const today         = this.today();
    const touchedToday  = lastActiveOn === today;
    const silentReady   = currentCount >= 7;
    const isNewRecord   = currentCount > 0 && currentCount === longestCount && touchedToday;
    const daysThisWeek  = this.buildWeekDots(lastActiveOn, currentCount);

    return {
      currentCount,
      longestCount,
      lastActiveOn,
      silentModeReady: silentReady,
      daysThisWeek,
      touchedToday,
      isNewRecord,
    };
  }
}
