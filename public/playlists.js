(() => {
  const form=document.querySelector('[data-playlist-form]'); if(!form)return;
  const list=form.querySelector('[data-selected-songs]'), results=form.querySelector('[data-song-results]'), status=form.querySelector('[data-playlist-status]'), query=form.querySelector('[data-song-query]');
  const selected=id=>Array.from(list.children).some(li=>li.dataset.songId===String(id));
  function add(song) {
    if(selected(song.id))return;
    const li=document.createElement('li'); li.dataset.songId=String(song.id);
    const input=document.createElement('input'); input.type='hidden';input.name='songIds';input.value=song.id;li.append(input);
    const text=document.createElement('span');text.textContent=`${song.songName || song.title} — ${song.artistName || ''}`;li.append(text);
    for(const [label,attribute,value] of [['↑','data-move','up'],['↓','data-move','down'],['Remove','data-remove','']]) {const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute(attribute,value); if(value)button.setAttribute('aria-label',`Move song ${value}`);li.append(button);}
    list.append(li);status.textContent=`${list.children.length} songs selected`;
  }
  list.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;const li=button.closest('li');
    if(button.hasAttribute('data-remove'))li.remove();
    if(button.dataset.move==='up'&&li.previousElementSibling)list.insertBefore(li,li.previousElementSibling);
    if(button.dataset.move==='down'&&li.nextElementSibling)list.insertBefore(li.nextElementSibling,li);
    status.textContent=`${list.children.length} songs selected`;
  });
  let controller;
  async function search(){
    controller?.abort();controller=new AbortController();status.textContent='Finding songs…';
    try {
      const response=await fetch(new URL(`song-search?q=${encodeURIComponent(query.value)}`,location.href),{signal:controller.signal});
      if(!response.ok)throw new Error();const data=await response.json();results.replaceChildren();
      for(const song of data.songs){const row=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button');text.textContent=`${song.songName || song.title} — ${song.artistName || ''}`;button.type='button';button.textContent=selected(song.id)?'Added':'Add song';button.disabled=selected(song.id);button.onclick=()=>{add(song);button.textContent='Added';button.disabled=true;};row.append(text,button);results.append(row);}
      status.textContent=data.songs.length?`${data.songs.length} songs found`:'No songs found. Try another search.';
    } catch(error){if(error.name!=='AbortError')status.textContent='Song search unavailable. Try again.';}
  }
  form.querySelector('[data-find-songs]').onclick=search;
  query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search();}});
  form.addEventListener('submit',event=>{if(!list.children.length){event.preventDefault();status.textContent='Add at least one song before saving.';query.focus();}});
})();
