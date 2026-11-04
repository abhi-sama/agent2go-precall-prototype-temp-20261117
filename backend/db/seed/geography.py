"""Real-world geography for the synthetic territories.

Every territory sits in one real US state or one real country, and every call address
and insight country the generator writes is derived from the entry below, so the
territory map, the call address columns (``city``, ``st_cd``, ``pstl_cd``) and the
insight country columns (``insight_country``, ``country_nm``) cannot disagree.

Pure data and stdlib only, so the unit test (``backend/db/tests/test_geography.py``)
runs without a database. Coordinates are the primary city's, to two decimals.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class City:
    name: str
    postal_code: str
    street: str


@dataclass(frozen=True)
class TerritoryGeography:
    territory_id: str
    country_code: str  # ISO 3166-1 alpha-2
    country_name: str
    subdivision_code: str  # source st_cd: USPS code for the US, the local code elsewhere
    subdivision_name: str
    latitude: float
    longitude: float
    cities: tuple[City, City]  # the first is the territory's primary city

    @property
    def primary_city(self) -> str:
        return self.cities[0].name


US = ("US", "United States")


def _us(tid: str, code: str, state: str, lat: float, lon: float, a: City, b: City) -> TerritoryGeography:
    return TerritoryGeography(tid, *US, code, state, lat, lon, (a, b))


def _intl(tid: str, country: tuple[str, str], sub: tuple[str, str], lat: float, lon: float, a: City, b: City) -> TerritoryGeography:
    return TerritoryGeography(tid, *country, *sub, lat, lon, (a, b))


# Regions mix US states with international countries so that every Executive scope has
# more than one country on the globe. 18 US territories and 6 in other countries.
GEOGRAPHY: tuple[TerritoryGeography, ...] = (
    # REGION-01
    _us("T01-01", "MA", "Massachusetts", 42.36, -71.06, City("Boston", "02115", "330 Brookline Ave"), City("Worcester", "01655", "55 Lake Ave N")),
    _us("T01-02", "NY", "New York", 40.71, -74.01, City("New York", "10065", "1275 York Ave"), City("Albany", "12208", "43 New Scotland Ave")),
    _us("T01-03", "PA", "Pennsylvania", 39.95, -75.17, City("Philadelphia", "19104", "3400 Spruce St"), City("Pittsburgh", "15213", "200 Lothrop St")),
    _us("T01-04", "CT", "Connecticut", 41.76, -72.67, City("Hartford", "06102", "80 Seymour St"), City("New Haven", "06510", "20 York St")),
    _us("T01-05", "NJ", "New Jersey", 40.74, -74.17, City("Newark", "07103", "185 S Orange Ave"), City("Princeton", "08540", "1 Nassau St")),
    _intl("T01-06", ("CA", "Canada"), ("ON", "Ontario"), 43.65, -79.38, City("Toronto", "M5G 1X5", "610 University Ave"), City("Ottawa", "K1H 8L6", "501 Smyth Rd")),
    # REGION-02
    _us("T02-01", "GA", "Georgia", 33.75, -84.39, City("Atlanta", "30322", "1365 Clifton Rd NE"), City("Savannah", "31404", "4700 Waters Ave")),
    _us("T02-02", "NC", "North Carolina", 35.23, -80.84, City("Charlotte", "28203", "1000 Blythe Blvd"), City("Raleigh", "27610", "3100 New Bern Ave")),
    _us("T02-03", "FL", "Florida", 25.76, -80.19, City("Miami", "33136", "1475 NW 12th Ave"), City("Tampa", "33612", "12902 Magnolia Dr")),
    _us("T02-04", "TN", "Tennessee", 36.16, -86.78, City("Nashville", "37232", "1211 Medical Center Dr"), City("Memphis", "38105", "262 Danny Thomas Pl")),
    _us("T02-05", "TX", "Texas", 29.76, -95.37, City("Houston", "77030", "1515 Holcombe Blvd"), City("Dallas", "75390", "5323 Harry Hines Blvd")),
    _intl("T02-06", ("GB", "United Kingdom"), ("ENG", "England"), 51.51, -0.13, City("London", "NW1 2BU", "250 Euston Rd"), City("Manchester", "M20 4BX", "550 Wilmslow Rd")),
    # REGION-03
    _us("T03-01", "IL", "Illinois", 41.88, -87.63, City("Chicago", "60611", "251 E Huron St"), City("Springfield", "62702", "701 N 1st St")),
    _us("T03-02", "MI", "Michigan", 42.33, -83.05, City("Detroit", "48201", "4160 John R St"), City("Ann Arbor", "48109", "1500 E Medical Center Dr")),
    _us("T03-03", "MN", "Minnesota", 44.98, -93.27, City("Minneapolis", "55455", "516 Delaware St SE"), City("Rochester", "55905", "200 First St SW")),
    _us("T03-04", "OH", "Ohio", 39.96, -83.00, City("Columbus", "43210", "410 W 10th Ave"), City("Cleveland", "44195", "9500 Euclid Ave")),
    _intl("T03-05", ("DE", "Germany"), ("BY", "Bavaria"), 48.14, 11.58, City("Munich", "81377", "Marchioninistrasse 15"), City("Nuremberg", "90419", "Prof-Ernst-Nathan-Strasse 1")),
    _intl("T03-06", ("FR", "France"), ("IDF", "Ile-de-France"), 48.86, 2.35, City("Paris", "75013", "47 Boulevard de l'Hopital"), City("Versailles", "78150", "177 Rue de Versailles")),
    # REGION-04
    _us("T04-01", "WA", "Washington", 47.61, -122.33, City("Seattle", "98104", "325 9th Ave"), City("Spokane", "99204", "101 W 8th Ave")),
    _us("T04-02", "OR", "Oregon", 45.52, -122.68, City("Portland", "97239", "3181 SW Sam Jackson Park Rd"), City("Eugene", "97401", "1255 Hilyard St")),
    _us("T04-03", "CA", "California", 37.77, -122.42, City("San Francisco", "94143", "505 Parnassus Ave"), City("Los Angeles", "90095", "757 Westwood Plaza")),
    _us("T04-04", "AZ", "Arizona", 33.45, -112.07, City("Phoenix", "85004", "550 E Van Buren St"), City("Tucson", "85724", "1501 N Campbell Ave")),
    _intl("T04-05", ("JP", "Japan"), ("13", "Tokyo"), 35.68, 139.69, City("Tokyo", "113-8655", "7-3-1 Hongo, Bunkyo-ku"), City("Tokyo", "160-0023", "6-7-1 Nishi-Shinjuku")),
    _intl("T04-06", ("BR", "Brazil"), ("SP", "Sao Paulo"), -23.55, -46.63, City("Sao Paulo", "01246-903", "Av Dr Eneas de Carvalho Aguiar 255"), City("Campinas", "13083-970", "Rua Tessalia Vieira de Camargo 126")),
)

BY_TERRITORY = {g.territory_id: g for g in GEOGRAPHY}


def city_for(territory_id: str, call_index: int) -> City:
    """Deterministic city for a call: one of the territory's two cities, alternating."""
    return BY_TERRITORY[territory_id].cities[call_index % 2]
