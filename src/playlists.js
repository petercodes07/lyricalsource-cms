const { escape: e, layout, cmsUrl } = require('./views');
const { request } = require('./site-api');
const { cover, edit } = require('./library-ui');
module.exports = (app, requireLogin, sitePublic) => {
  const curator = (req, res, next) => req.user.role === 'author' ? res.status(403).send('Playlist editing requires an editor role') : next();
  const selectedSong = song => `<li data-song-id="${Number(song.id)}"><input type="hidden" name="songIds" value="${Number(song.id)}"><span>${e(song.songName || song.title)} — ${e(song.artistName)}</span><button type="button" data-move="up" aria-label="Move song up">↑</button><button type="button" data-move="down" aria-label="Move song down">↓</button><button type="button" data-remove>Remove</button></li>`;
  function form(playlist, error = '') {
    return `<h1>${playlist.existing ? 'Edit playlist' : 'New playlist'}</h1>${error ? `<p class="notice" role="alert">${e(error)}</p>${playlist.existing ? `<p><a href="/playlists/${e(playlist.slug)}" target="_blank" rel="noopener noreferrer">Open latest version in another tab</a></p>` : ''}` : ''}<p>Choose songs for a playlist on LyricalSource. Saving makes it available on the website.</p><form class="card" method="post" data-playlist-form data-editor-form ${error?'data-unsaved="1"':''} ${playlist.existing ? `data-editing="playlists/${e(playlist.slug)}"` : ''}><input type="hidden" name="version" value="${e(playlist.version)}"><div class="row"><label>Name<input name="name" required maxlength="200" value="${e(playlist.name)}"></label><label>Slug<input name="slug" required maxlength="200" pattern="[a-z0-9]+(-[a-z0-9]+)*" ${playlist.existing ? 'readonly' : ''} value="${e(playlist.slug)}"></label></div><label>Description<textarea name="description" maxlength="5000">${e(playlist.description)}</textarea></label>${playlist.image || playlist.trackImage ? `<div class="album-summary">${cover(playlist.image || playlist.trackImage, sitePublic, playlist.name)}</div>` : ''}<label>Cover image URL<input name="image" type="url" value="${e(playlist.image)}" placeholder="https://…"></label><h2>Songs</h2><ol class="playlist-selected" data-selected-songs>${(playlist.songs || []).map(selectedSong).join('')}</ol><p data-playlist-status role="status"></p><label>Find songs<input type="search" data-song-query placeholder="Search song names or titles"></label><button type="button" data-find-songs>Search songs</button><div class="playlist-results" data-song-results></div><p class="row actions"><button>Save playlist</button>${playlist.existing ? `<a class="button secondary" href="${e(sitePublic + '/playlists/' + playlist.slug)}" target="_blank" rel="noopener noreferrer">View playlist on website</a>` : ''}</p></form><script defer src="/playlists.js"></script>`;
  }
  app.get('/playlists', requireLogin, curator, async (req,res)=>{
    try {
      const page = Math.min(100000,Math.max(1,Math.floor(Number(req.query.page)||1)));
      const q = String(req.query.q||'').trim().slice(0,200);
      const {playlists,total} = await request('GET',`playlists?page=${page}&q=${encodeURIComponent(q)}`);
      const rows=playlists.map(p=>`<tr><td><div class="story-cell">${cover(p.image || p.trackImage, sitePublic, p.name)}<div><a class="story-title" href="/playlists/${e(p.slug)}">${e(p.name)}</a><span class="story-slug">${e(p.description)}</span></div></div></td><td>${Number(p.songCount)}</td><td>${edit('/playlists/' + p.slug, p.name)}</td></tr>`).join('');
      res.send(layout('Playlists',req.user,`<h1>Playlists</h1><p>Manage the song collections on LyricalSource.</p><form method="get"><label>Search playlists<input name="q" value="${e(q)}" maxlength="200"></label><button>Search</button></form><p><a class="button" href="/playlists/new">New playlist</a></p><div class="card table-card"><table><tr><th>Playlist</th><th>Songs</th><th>Actions</th></tr>${rows || '<tr><td colspan="3">No playlists yet. Create the first playlist.</td></tr>'}</table></div><p>${Number(total)} playlists</p><nav aria-label="Playlist pages">${page>1?`<a href="/playlists?page=${page-1}&q=${e(encodeURIComponent(q))}">Previous</a>`:''} ${page*50<total?`<a href="/playlists?page=${page+1}&q=${e(encodeURIComponent(q))}">Next</a>`:''}</nav>`,req.query.notice));
    } catch(error) {res.status(502).send(layout('Playlists',req.user,'<h1>Playlists unavailable</h1>',error.message));}
  });
  app.get('/playlists/song-search', requireLogin, curator, async(req,res)=>{
    try {res.json(await request('GET',`songs?q=${encodeURIComponent(String(req.query.q || '').slice(0,200))}`));} catch {res.status(502).json({error:'Song search unavailable. Try again.'});}
  });
  app.get('/playlists/new', requireLogin, curator, (req,res)=>res.send(layout('New playlist',req.user,form({name:'',slug:'',description:'',image:'',songs:[]}))));
  app.get('/playlists/:slug', requireLogin, curator, async(req,res)=>{
    try {const {playlist}=await request('GET',`playlists?slug=${encodeURIComponent(req.params.slug)}`); res.send(layout('Edit playlist',req.user,form({...playlist,existing:true}),req.query.notice));}
    catch(error){res.status(502).send(layout('Playlists',req.user,'<h1>Cannot open playlist</h1>',error.message));}
  });
  app.post('/playlists/:slug', requireLogin, curator, async(req,res)=>{
    const create=req.params.slug==='new';
    const ids = [].concat(req.body.songIds || []).map(Number);
    const playlist={name:String(req.body.name || '').trim(),slug:create?String(req.body.slug || '').trim():req.params.slug,description:String(req.body.description || '').trim(),image:String(req.body.image || '').trim(),version:Number(req.body.version)};
    try {
      if(!playlist.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(playlist.slug) || !ids.length || ids.length > 500 || ids.some(id=>!Number.isSafeInteger(id)||id<1) || new Set(ids).size!==ids.length) throw new Error('Enter a name, valid slug, and at least one song.');
      await request(create?'POST':'PUT','playlists',{...playlist,songs:ids});
      res.redirect(cmsUrl(`/playlists/${encodeURIComponent(playlist.slug)}?notice=Playlist+saved`));
    } catch(error) {
      // One bulk lookup instead of hundreds of requests while reconstructing a failed save.
      let songs = ids.slice(0,500).map(id => ({ id, title: 'Selected song #' + id, artistName: '' }));
      try {
        const data = await request('GET', `songs?ids=${encodeURIComponent(ids.slice(0,500).filter(id=>Number.isSafeInteger(id)&&id>0).join(','))}`);
        const byId = new Map(data.songs.map(song => [song.id,song]));
        songs = songs.map(song => byId.get(song.id) || song);
      } catch {}

      res.status(error.status || 400).send(layout(create?'New playlist':'Edit playlist',req.user,form({...playlist,songs,existing:!create},error.message)));
    }
  });
};
