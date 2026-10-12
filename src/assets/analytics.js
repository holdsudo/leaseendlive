/* Lease End Live analytics. GA4 when window.LEL.ga is set; otherwise events are only
   logged to the console (local preview). Every event goes through lelTrack(name, params).

   Events (all carry episode_id / show when relevant):
     page_view            sent manually on every in-site navigation (the player keeps playing)
     audio_start          first play of an episode in this page session
     audio_play/pause     every play / pause
     audio_progress       percent = 10, 25, 50, 75, 90
     audio_complete       reached the end
     listen_time          seconds actually listened (sent every 30s of playback and on pause/leave)
     audio_seek           from, to (seconds), via = wave | transcript | bar | keys | link
     playback_rate        rate
     platform_click       platform = apple | spotify | youtube | amazon | iheart | pocketcasts | rss
     share                method = copy | time | x | facebook | linkedin | download
     transcript_jump      seconds
     ask_submit           show
     cta_click            cta = which call to action (quote, call, ask, company)
*/
(function () {
  var cfg = window.LEL || {};
  var id = cfg.ga;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { dataLayer.push(arguments); };
  if (id) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    gtag('js', new Date());
    // page_view is sent by app.js so in-site navigation is counted too
    gtag('config', id, { send_page_view: false, transport_type: 'beacon' });
  }
  window.lelTrack = function (name, params) {
    params = params || {};
    try {
      if (id) gtag('event', name, params);
      else if (/^(localhost|127\.|192\.168\.)/.test(location.hostname)) console.debug('[lel]', name, params);
    } catch (e) {}
  };
  window.lelPageView = function () {
    lelTrack('page_view', { page_location: location.href, page_path: location.pathname, page_title: document.title });
  };
  lelPageView();
})();
