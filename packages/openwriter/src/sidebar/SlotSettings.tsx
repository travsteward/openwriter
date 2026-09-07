import { useState, useEffect, useRef } from 'react';
import './SlotSettings.css';

interface Slot {
  id: string;
  time: string;
  days: string[];
  filter_type: string;
  filter_value: string | null;
  timezone: string;
}

interface SlotSettingsProps {
  slots: Slot[];
  onBack: () => void;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FILTER_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'content_type', label: 'Content Type' },
  { value: 'connection', label: 'Connection' },
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'America/Sao_Paulo',
  'America/Mexico_City',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Moscow',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
];

function formatTzLabel(tz: string): string {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' });
    const parts = fmt.formatToParts(now);
    const abbr = parts.find(p => p.type === 'timeZoneName')?.value || '';
    const city = tz.split('/').pop()!.replace(/_/g, ' ');
    return `${city} (${abbr})`;
  } catch {
    return tz;
  }
}

function detectTimezone(slots: Slot[]): string {
  if (slots.length > 0) return slots[0].timezone;
  try {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local) return local;
  } catch { /* ignore */ }
  return 'UTC';
}

export default function SlotSettings({ slots: initialSlots, onBack }: SlotSettingsProps) {
  const [slots, setSlots] = useState<Slot[]>(initialSlots);
  const [timezone, setTimezone] = useState(() => detectTimezone(initialSlots));
  const [tzOpen, setTzOpen] = useState(false);
  const [newTime, setNewTime] = useState('09:00');
  const [newDays, setNewDays] = useState<string[]>(['default']);
  const [newFilter, setNewFilter] = useState('any');
  const [adding, setAdding] = useState(false);
  const tzRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!tzOpen) return;
    function handleClick(e: MouseEvent) {
      if (tzRef.current && !tzRef.current.contains(e.target as Node)) setTzOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [tzOpen]);

  async function handleTimezoneChange(newTz: string) {
    setTimezone(newTz);
    const updated: Slot[] = [];
    for (const slot of slots) {
      const res = await fetch(`/api/scheduler/slots/${slot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: newTz }),
      });
      if (res.ok) {
        const data = await res.json();
        updated.push(data.slot);
      } else {
        updated.push(slot);
      }
    }
    if (updated.length > 0) setSlots(updated);
  }

  async function handleCreate() {
    const res = await fetch('/api/scheduler/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        time: newTime,
        days: newDays.includes('default') ? ['default'] : newDays,
        filter_type: newFilter,
        timezone,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setSlots(prev => [...prev, data.slot]);
      setAdding(false);
      setNewTime('09:00');
      setNewDays(['default']);
      setNewFilter('any');
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/scheduler/slots/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setSlots(prev => prev.filter(s => s.id !== id));
    }
  }

  function toggleDay(day: string) {
    setNewDays(prev => {
      if (day === 'default') return ['default'];
      const without = prev.filter(d => d !== 'default');
      if (without.includes(day)) {
        const result = without.filter(d => d !== day);
        return result.length === 0 ? ['default'] : result;
      }
      return [...without, day];
    });
  }

  return (
    <div className="sidebar-schedule">
      <div className="sidebar-schedule-header">
        <button className="sidebar-schedule-btn" onClick={onBack} title="Back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h3>Slot Settings</h3>
        <button className="sidebar-schedule-btn" onClick={() => setAdding(!adding)}>
          {adding ? 'Cancel' : '+ Add'}
        </button>
      </div>

      <div className="slot-tz" ref={tzRef}>
        <label className="slot-tz-label">Timezone</label>
        <button className="slot-tz-trigger" onClick={() => setTzOpen(!tzOpen)}>
          <span>{formatTzLabel(timezone)}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`slot-tz-chevron ${tzOpen ? 'slot-tz-chevron--open' : ''}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {tzOpen && (
          <div className="slot-tz-dropdown">
            {[...new Set([timezone, ...TIMEZONES])].map(tz => (
              <div
                key={tz}
                className={`slot-tz-option ${tz === timezone ? 'active' : ''}`}
                onClick={() => { handleTimezoneChange(tz); setTzOpen(false); }}
              >
                {formatTzLabel(tz)}
              </div>
            ))}
          </div>
        )}
      </div>

      {adding && (
        <div className="slot-add-form">
          <div className="slot-add-row">
            <input
              type="time"
              className="slot-input"
              value={newTime}
              onChange={e => setNewTime(e.target.value)}
            />
            <select
              className="slot-input"
              value={newFilter}
              onChange={e => setNewFilter(e.target.value)}
            >
              {FILTER_OPTIONS.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div className="slot-add-days">
            <button
              className={`sidebar-schedule-btn slot-day-btn ${newDays.includes('default') ? 'sidebar-schedule-btn--active' : ''}`}
              onClick={() => toggleDay('default')}
            >
              Every day
            </button>
            {DAYS.map(d => (
              <button
                key={d}
                className={`sidebar-schedule-btn slot-day-btn ${newDays.includes(d.toLowerCase()) ? 'sidebar-schedule-btn--active' : ''}`}
                onClick={() => toggleDay(d.toLowerCase())}
              >
                {d}
              </button>
            ))}
          </div>
          <button
            className="sidebar-schedule-btn sidebar-schedule-btn--active slot-create-btn"
            onClick={handleCreate}
          >
            Create Slot
          </button>
        </div>
      )}

      <div className="slot-list">
        {slots.length === 0 ? (
          <div className="schedule-empty">
            <div className="schedule-empty-title">No slots</div>
            <div className="schedule-empty-desc">Create time slots to define your posting schedule.</div>
          </div>
        ) : (
          slots.map(slot => (
            <div key={slot.id} className="schedule-item slot-item">
              <div className="schedule-item-time slot-item-time">
                {formatSlotTime(slot.time)}
              </div>
              <div className="schedule-item-content">
                <div className="schedule-item-text">
                  {slot.days.includes('default') ? 'Every day' : slot.days.join(', ')}
                </div>
                <div className="schedule-item-meta">
                  <span>Filter: {slot.filter_type}</span>
                  {slot.filter_value && <span>({slot.filter_value})</span>}
                </div>
              </div>
              <button
                className="schedule-item-action schedule-item-action--danger slot-delete-btn"
                onClick={() => handleDelete(slot.id)}
                title="Delete slot"
              >
                &times;
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatSlotTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}
