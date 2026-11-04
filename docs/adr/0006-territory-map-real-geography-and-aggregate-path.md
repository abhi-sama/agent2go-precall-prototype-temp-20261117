# Territory map: bundled real geography and an aggregate path for Executives

The landing page shows territories on real geography: an Executive opens on a 3D globe (react-globe.gl, MIT), tapping a country flies in and swaps to a flat Apache ECharts map of that country, and tapping a state or territory opens it.
MSLs and Directors open directly on the flat map of their own scope.
Where WebGL is missing or the viewer prefers reduced motion, everyone gets the flat map and nothing animates.

- **Shapes are bundled, not fetched.** Natural Earth countries (`world-atlas`) and US Census states (`us-atlas`, Albers USA) are public domain and ship in the JavaScript bundle.
  There is no tile server, no key and no globe texture, so the map works offline and makes no third-party request (the iPad smoke test asserts it).
- **Geography is data.** `territory_geography` (migration 006) places each leaf territory in one US state or country.
  The generator derives the call address columns (`city`, `st_cd`, `pstl_cd`) and the insight country columns from the same table, and tests check they agree.
  Regions mix US states with other countries, so every Executive's globe shows more than one country.
- **Counts come from the API.** `geoActivity` returns distinct calls per territory and per country (the country figure is counted across its territories, not summed).
  Only in-scope territories are returned, so out-of-scope ones are never named or coloured.
- **Executives get counts, never rows.** They hold only `aggregate.read`, so RLS returns them no call rows.
  `app.geo_territories`, `app.geo_countries` and `app.aggregate_data_through` are SECURITY DEFINER functions that check `aggregate.read`, restrict to `app.current_scope_territories()` and return aggregates.
  For callers without `source.records.read`, counts under 5 are returned as null (`suppressed`), and a country total is hidden when any of its territories is, so a hidden count cannot be subtracted back out.
