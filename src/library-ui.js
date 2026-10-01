const { escape:e }=require('./views');
function cover(image, sitePublic, title='') {
  const url=image?.startsWith('/')&&!image.startsWith('//')?sitePublic+image:image;
  return url&&/^https?:\/\//.test(url)?`<img class="story-thumb" src="${e(url)}" alt="${e(title)} cover" loading="lazy">`:'<span class="story-thumb story-placeholder" aria-label="No cover image">♪</span>';
}
function edit(url,title) {return `<a class="button secondary library-edit" href="${e(url)}" aria-label="Edit ${e(title)}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg> Edit</a>`;}
module.exports={cover,edit};
