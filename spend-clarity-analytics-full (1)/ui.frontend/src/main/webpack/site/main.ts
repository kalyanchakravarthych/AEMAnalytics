// Site entry-point.
// Styles are imported via main.scss.
// Component JavaScript is auto-included via the components glob below.
// The previously-included site-folder globs have been removed because
// the site/ folder contains no JS or TS files - leaving them in produced
// webpack glob-import-loader "empty results" warnings on every build.

// Stylesheets
import "./main.scss";

// Component JavaScript (auto-globbed from webpack/components/).
import "../components/**/*.js";
