import { useState, useMemo } from 'react';
import { ASSET_MAP } from '../assetMap';
import { Search } from 'lucide-react';

export function AssetViewer() {
  const [search, setSearch] = useState('');
  
  const filteredAssets = useMemo(() => {
    return ASSET_MAP.filter(asset => asset.toLowerCase().includes(search.toLowerCase()));
  }, [search]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    ASSET_MAP.forEach(a => {
       const parts = a.split('/');
       if (parts.length > 3) {
          cats.add(parts[3]);
       }
    });
    return Array.from(cats);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
       <div className="relative mb-4 shrink-0">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input 
             type="text" 
             value={search}
             onChange={e => setSearch(e.target.value)}
             placeholder="Search assets (e.g. 'gun', 'hitman')"
             className="w-full pl-10 pr-4 py-3 bg-neutral-100 border border-neutral-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
          />
       </div>
       <div className="flex gap-2 pb-4 overflow-x-auto scrollbar-hide shrink-0">
         <button 
           onClick={() => setSearch('')}
           className={`px-3 py-1.5 rounded-lg text-sm font-bold shrink-0 transition-colors ${!search ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
         >
           All
         </button>
         {categories.map(cat => (
           <button 
             key={cat}
             onClick={() => setSearch(cat)}
             className={`px-3 py-1.5 rounded-lg text-sm font-bold shrink-0 transition-colors ${search === cat ? 'bg-indigo-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'}`}
           >
             {cat}
           </button>
         ))}
       </div>
       <div className="flex-1 overflow-y-auto min-h-0 bg-neutral-50 rounded-2xl border border-neutral-200 p-4">
         <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-4">
            {filteredAssets.map(asset => {
               const name = asset.split('/').pop() || '';
               return (
                 <div key={asset} className="flex flex-col items-center p-3 bg-white border border-neutral-200 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-300 transition-all group">
                   <div className="w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center mb-2">
                     {asset.endsWith('.svg') || asset.endsWith('.png') ? (
                       <img src={asset} alt={name} className="max-w-full max-h-full object-contain group-hover:scale-110 transition-transform pixelated" style={{ imageRendering: 'pixelated' }} />
                     ) : (
                        <div className="text-xs text-neutral-400 font-bold uppercase">{asset.split('.').pop()}</div>
                     )}
                   </div>
                   <span className="text-[10px] sm:text-xs font-mono text-neutral-500 truncate w-full text-center" title={name}>
                     {name}
                   </span>
                 </div>
               )
            })}
         </div>
         {filteredAssets.length === 0 && (
            <div className="w-full h-full flex items-center justify-center text-neutral-400 font-medium">
               No assets found matching "{search}"
            </div>
         )}
       </div>
    </div>
  )
}
