'use client';

import { useState } from 'react';

interface FeedbackModalProps {
  onClose: () => void;
}

const IMPROVEMENTS = [
  { id: 'more_sources',   label: 'Více zdrojů (Facebook, Letgo…)' },
  { id: 'price_alerts',   label: 'Cenová upozornění na e-mail' },
  { id: 'better_filters', label: 'Lepší filtry (stav, lokalita…)' },
  { id: 'mobile_app',     label: 'Mobilní aplikace' },
  { id: 'faster',         label: 'Rychlejší načítání výsledků' },
  { id: 'saved_searches', label: 'Uložená hledání' },
  { id: 'other',          label: 'Jiné (napište níže)' },
];

export function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [rating, setRating]           = useState<number | null>(null);
  const [hovered, setHovered]         = useState<number | null>(null);
  const [improvements, setImprovements] = useState<Set<string>>(new Set());
  const [comment, setComment]         = useState('');
  const [email, setEmail]             = useState('');
  const [status, setStatus]           = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  function toggleImprovement(id: string) {
    setImprovements((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return;

    setStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          improvements: [...improvements],
          comment: comment.trim() || null,
          email: email.trim() || null,
        }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  }

  const displayRating = hovered ?? rating;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Zpětná vazba</h2>
            <p className="text-sm text-slate-500 mt-0.5">Pomožte nám zlepšit aplikaci</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {status === 'done' ? (
          /* Success state */
          <div className="px-6 py-12 text-center">
            <div className="text-5xl mb-4">🙌</div>
            <h3 className="text-lg font-bold text-slate-900">Díky za zpětnou vazbu!</h3>
            <p className="text-slate-500 text-sm mt-1 mb-6">Vaše odpovědi nám hodně pomohou.</p>
            <button
              onClick={onClose}
              className="px-6 py-2.5 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 transition-colors"
            >
              Zavřít
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6 max-h-[80vh] overflow-y-auto">

            {/* Q1 – Star rating */}
            <div>
              <p className="text-sm font-semibold text-slate-800 mb-3">
                Jak jste spokojeni s aplikací? <span className="text-red-400">*</span>
              </p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    onMouseEnter={() => setHovered(star)}
                    onMouseLeave={() => setHovered(null)}
                    className={`text-3xl transition-transform ${
                      (displayRating ?? 0) >= star
                        ? 'text-yellow-400 scale-110'
                        : 'text-slate-200 hover:text-yellow-300'
                    }`}
                  >
                    ★
                  </button>
                ))}
                {rating && (
                  <span className="ml-2 self-center text-sm text-slate-500">
                    {['', 'Velmi špatně', 'Špatně', 'Průměrně', 'Dobře', 'Výborně'][rating]}
                  </span>
                )}
              </div>
            </div>

            {/* Q2 – What to improve */}
            <div>
              <p className="text-sm font-semibold text-slate-800 mb-3">
                Co byste chtěli přidat nebo zlepšit?
                <span className="text-slate-400 font-normal"> (vyberte vše, co platí)</span>
              </p>
              <div className="space-y-2">
                {IMPROVEMENTS.map(({ id, label }) => (
                  <label
                    key={id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                      improvements.has(id)
                        ? 'border-brand-400 bg-brand-50 text-brand-800'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={improvements.has(id)}
                      onChange={() => toggleImprovement(id)}
                    />
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                      improvements.has(id)
                        ? 'border-brand-500 bg-brand-500'
                        : 'border-slate-300'
                    }`}>
                      {improvements.has(id) && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Q3 – Free text */}
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                Libovolný komentář
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Co vám chybí, co se vám líbí, co byste změnili…"
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent placeholder:text-slate-400"
              />
            </div>

            {/* Q4 – Email (optional) */}
            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-2">
                E-mail <span className="text-slate-400 font-normal">(nepovinný — pro zpětnou odpověď)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vas@email.cz"
                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-transparent placeholder:text-slate-400"
              />
            </div>

            {status === 'error' && (
              <p className="text-sm text-red-500">Odeslání selhalo, zkuste to znovu.</p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-1 pb-1">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
              >
                Zrušit
              </button>
              <button
                type="submit"
                disabled={!rating || status === 'sending'}
                className="px-6 py-2.5 bg-brand-600 text-white text-sm font-semibold rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {status === 'sending' ? 'Odesílám…' : 'Odeslat zpětnou vazbu'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
