'use client';

import { useState } from 'react';
import type { DebugInfo, Source } from '@sdf/types';

interface DebugPanelProps {
  debug: DebugInfo;
}

export function DebugPanel({ debug }: DebugPanelProps) {
  const [tab, setTab] = useState<'raw' | 'dedup' | 'logs'>('raw');

  return (
    <div className="mt-8 border border-yellow-300 rounded-2xl overflow-hidden text-xs font-mono">
      <div className="bg-yellow-50 px-4 py-2 flex items-center gap-3 border-b border-yellow-300">
        <span className="font-semibold text-yellow-800">🔍 Debug Panel</span>
        {(['raw', 'dedup', 'logs'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              tab === t
                ? 'text-yellow-900 font-bold underline'
                : 'text-yellow-600 hover:text-yellow-800'
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="bg-white p-4 overflow-x-auto max-h-96 overflow-y-auto">
        {tab === 'raw' && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="pb-1 pr-3">ID</th>
                <th className="pb-1 pr-3">Source</th>
                <th className="pb-1 pr-3">Title</th>
                <th className="pb-1 pr-3">Price</th>
                <th className="pb-1 pr-3">Condition</th>
                <th className="pb-1 pr-3">Promoted</th>
              </tr>
            </thead>
            <tbody>
              {debug.rawListings.map((l) => (
                <tr key={l.id} className="border-b border-slate-100">
                  <td className="py-1 pr-3 text-slate-400">{l.id}</td>
                  <td className="py-1 pr-3">{l.source}</td>
                  <td className="py-1 pr-3 max-w-xs truncate">{l.title}</td>
                  <td className="py-1 pr-3">{l.price ?? '–'}</td>
                  <td className="py-1 pr-3">{l.condition}</td>
                  <td className="py-1 pr-3">{l.promoted ? '⚠️ yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'dedup' && (
          <div className="space-y-2">
            {Object.entries(debug.dedupeGroups).length === 0 ? (
              <p className="text-slate-400">No duplicates detected.</p>
            ) : (
              Object.entries(debug.dedupeGroups).map(([group, ids]) => (
                <div key={group}>
                  <p className="font-bold text-orange-600">{group}</p>
                  {ids.map((id) => (
                    <p key={id} className="ml-4 text-slate-500">
                      {id}
                    </p>
                  ))}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'logs' && (
          <div className="space-y-3">
            {Object.entries(debug.adapterLogs ?? {}).map(([source, logs]) => (
              <div key={source}>
                <p className="font-bold text-slate-600 mb-1">[{source}]</p>
                {(logs as string[]).length === 0 ? (
                  <p className="ml-4 text-slate-400">No logs.</p>
                ) : (
                  (logs as string[]).map((log, i) => (
                    <p key={i} className="ml-4 text-slate-500">
                      {log}
                    </p>
                  ))
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
