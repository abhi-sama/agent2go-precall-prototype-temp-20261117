"""Unit checks on the territory geography data. Stdlib only; no database needed.

    python3 -m unittest discover -s backend/db/tests
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "seed"))
from geography import BY_TERRITORY, GEOGRAPHY, city_for  # noqa: E402

REGION_SIZE = 6
US_STATES = {
    "MA": "Massachusetts", "NY": "New York", "PA": "Pennsylvania", "CT": "Connecticut", "NJ": "New Jersey",
    "GA": "Georgia", "NC": "North Carolina", "FL": "Florida", "TN": "Tennessee", "TX": "Texas",
    "IL": "Illinois", "MI": "Michigan", "MN": "Minnesota", "OH": "Ohio",
    "WA": "Washington", "OR": "Oregon", "CA": "California", "AZ": "Arizona",
}


class GeographyTest(unittest.TestCase):
    def test_covers_the_24_seeded_territories_in_order(self):
        expected = [f"T{r:02}-{n:02}" for r in range(1, 5) for n in range(1, REGION_SIZE + 1)]
        self.assertEqual([g.territory_id for g in GEOGRAPHY], expected)

    def test_most_territories_are_distinct_real_us_states(self):
        us = [g for g in GEOGRAPHY if g.country_code == "US"]
        self.assertEqual(len(us), 18)
        self.assertEqual(len({g.subdivision_code for g in us}), 18)
        for g in us:
            self.assertEqual(US_STATES[g.subdivision_code], g.subdivision_name, g.territory_id)
            self.assertEqual(g.country_name, "United States")

    def test_a_handful_of_other_countries_with_every_region_on_the_globe_twice(self):
        others = {g.country_code for g in GEOGRAPHY if g.country_code != "US"}
        self.assertEqual(others, {"CA", "GB", "DE", "FR", "JP", "BR"})
        for r in range(4):
            countries = {g.country_code for g in GEOGRAPHY[r * REGION_SIZE : (r + 1) * REGION_SIZE]}
            self.assertGreaterEqual(len(countries), 2, f"region {r + 1} must show more than one country")

    def test_cities_have_valid_postal_codes_for_their_country(self):
        shapes = {
            "US": r"\d{5}", "CA": r"[A-Z]\d[A-Z] \d[A-Z]\d", "GB": r"[A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}",
            "DE": r"\d{5}", "FR": r"\d{5}", "JP": r"\d{3}-\d{4}", "BR": r"\d{5}-\d{3}",
        }
        for g in GEOGRAPHY:
            for c in g.cities:
                self.assertRegex(c.postal_code, f"^{shapes[g.country_code]}$", f"{g.territory_id} {c.name}")
                self.assertTrue(c.street and c.name)

    def test_us_zip_codes_belong_to_the_state(self):
        zip3 = {
            "MA": range(10, 28), "NY": range(100, 150), "PA": range(150, 197), "CT": range(60, 70), "NJ": range(70, 90),
            "GA": [*range(300, 320), 398, 399], "NC": range(270, 290), "FL": range(320, 350), "TN": range(370, 386),
            "TX": [*range(750, 800), 885], "IL": range(600, 630), "MI": range(480, 500), "MN": range(550, 568),
            "OH": range(430, 459), "WA": range(980, 995), "OR": range(970, 980), "CA": range(900, 962), "AZ": range(850, 866),
        }
        for g in GEOGRAPHY:
            if g.country_code == "US":
                for c in g.cities:
                    self.assertIn(int(c.postal_code[:3]), zip3[g.subdivision_code], f"{g.territory_id} {c.name} {c.postal_code}")

    def test_coordinates_are_plausible_and_the_primary_city_is_first(self):
        for g in GEOGRAPHY:
            self.assertTrue(-90 <= g.latitude <= 90 and -180 <= g.longitude <= 180)
            self.assertEqual(g.primary_city, g.cities[0].name)

    def test_city_choice_is_deterministic_and_alternates(self):
        self.assertEqual(city_for("T01-01", 0), BY_TERRITORY["T01-01"].cities[0])
        self.assertEqual(city_for("T01-01", 1), BY_TERRITORY["T01-01"].cities[1])
        self.assertEqual(city_for("T01-01", 2), city_for("T01-01", 0))


if __name__ == "__main__":
    unittest.main()
