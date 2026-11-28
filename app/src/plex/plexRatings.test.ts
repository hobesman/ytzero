import { expect, test } from "bun:test";
import { parsePlexRatingLevel, plexRatingAllowed, plexRatingLevel } from "./plexRatings";

test("movie and TV ratings share levels, and a level lets through every one below it", () => {
  expect(["G", "TV-Y", "TV-G", "PG", "TV-PG"].every((rating) => plexRatingAllowed(rating, "pg"))).toBe(true);
  expect(["PG-13", "TV-14", "R", "TV-MA", "NC-17"].some((rating) => plexRatingAllowed(rating, "pg"))).toBe(false);
  expect(plexRatingAllowed("TV-14", "pg13")).toBe(true);
  expect(plexRatingAllowed("TV-MA", "pg13")).toBe(false);
});

test("country prefixes are read, and an unrated title shows only under any rating", () => {
  expect(plexRatingLevel("gb/12A")).toBe("pg13");
  expect(plexRatingLevel(" ca/pg ")).toBe("pg");
  expect(plexRatingAllowed("", "r")).toBe(false);
  expect(plexRatingAllowed("Not Rated", "r")).toBe(false);
  expect(plexRatingAllowed("", "all")).toBe(true);
  expect(parsePlexRatingLevel("pg13")).toBe("pg13");
  expect(parsePlexRatingLevel("toString")).toBeNull();
});
