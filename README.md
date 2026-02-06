Bare minimum media server!

Fast, small, cross-platform, and portable. Run it, point it to your movies/TV shows/music and hit the scan button. Pick a port, click "start server", point your browser at it, job done. Sure, it's not pretty, it's not smart, but it does what it needs to.

Currently in a very early state, but I am trying to balance the line between keeping it lightweight and simple and making it useful, so at present these are the only planned additional features:
* Better metadata editing (particularly for TV shows)
* Improved "filename to title" sanitising/parsing for things with missing metadata; it's getting better but still has a few weaknesses. (Pro-tip: running it through my Jellyfin-Filemanager first helps!)
* Layout improvements
* A "server only" version (it'll have an ever smaller footprint, and can be run at startup without user intervention).

Beyond that, it's pretty much "feature complete" and only needs bugfixes. It's never going to fetch metadata from online sources, it's never going to have user management, it's never going to have transcoding, it's never going to have a *lot* of "standard" features. If you want those then there are plenty of options out there!

Until I add releases you'll have to run/build it by hand:
* Requires node.js and ffmpeg installed.
* Run *npm install* on downloaded files to grab dependencies
* Either build the package with electron-forge (or similar) or *npm start*

