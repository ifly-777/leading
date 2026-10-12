# Tables

Prose keeps its measure; tables may step out of the column into the margins, centred, when they need the room. Short columns never wrap, long text columns wrap at a sensible width, and sideways scrolling is a last resort.

## A small numeric table

Numbers are detected and right-aligned on tabular lining figures, while the prose around them uses old-style figures: 1,234 in a sentence.

| Leg | Distance (nm) | Trip fuel (kg) | Time | Margin |
|---|---|---|---|---|
| DXB–LHR | 2,962 | 61,450 | 7:05 | 4.2% |
| LHR–JFK | 2,999 | 64,900 | 7:40 | −1.5% |
| JFK–SFO | 2,247 | 41,300 | 5:55 | 12.0% |
| SFO–HNL | 2,091 | 38,750 | 5:20 | (0.8%) |
| HNL–SYD | 4,412 | 92,100 | 10:05 | 3.0% |

## Explicit alignment always wins

| Left | Centre | Right | Default number |
|:---|:---:|---:|---|
| a | b | c | 10 |
| longer text | centred | right | 2,000 |
| x | y | z | 300.5 |

## A long-text column

| Term | Definition | Source |
|---|---|---|
| Leading | The vertical distance between baselines of successive lines of type, named after the strips of lead once placed between rows of metal type by hand. | Printing trade |
| Measure | The length of a line of text, usually counted in characters; around sixty-six characters is the traditional comfortable target for continuous reading. | Bringhurst |
| Widow | A very short last line of a paragraph, or a single line of a paragraph stranded at the top of a new page, both of which break the even texture of the page. | Common usage |
| Kerning | Adjusting the space between particular pairs of letters, such as "AV" or "To", so that the gaps look even to the eye rather than measure even with a ruler. | Type design |

## Inline formatting, links, code and escapes

| Feature | Example | Notes |
|---|---|---|
| **Bold** and *italic* | **strong** *emphasis* ~~struck~~ | Formatting inside cells |
| Code | `npm run proto` | Should not wrap |
| Link | [MarkEdit](https://github.com/MarkEdit-app/MarkEdit) | Reference project |
| Escaped pipe | a \| b | One cell, not two |
| Highlight | ==marked== cell | Yellow |
| Empty |  | Left blank |
| Wikilink | [[Typography]] | Styled, not clickable |
| CJK | 行間と字間 | Japanese for "leading and tracking" |

## A wide table that must scroll

Twelve columns cannot fit beside each other on a laptop screen. This table should step out of the column, use the full window, and only then scroll sideways, with the first column pinned and the right edge fading while there is more to see.

| Station | Wind | Visibility | Weather | Cloud | Temp | Dew point | QNH | Trend | RVR 1 | RVR 2 | Remarks |
|---|---|---|---|---|---|---|---|---|---|---|---|
| OMDB | 31012KT | 6000 | HZ | FEW040 | 38 | 21 | 1003 | NOSIG | P2000 | P2000 | Dust haze over the Gulf, improving after sunset |
| EGLL | 24018G28KT | 9999 | -RA | BKN012 OVC020 | 14 | 12 | 998 | TEMPO 4000 RA | 1500 | 1800 | Gusts at the threshold of runway 27L |
| KJFK | 18009KT | 10SM | – | SCT250 | 26 | 17 | 1016 | – | – | – | Sea breeze expected by mid-afternoon |
| VABB | 25014KT | 3000 | RA BR | SCT008 BKN015 | 27 | 26 | 1004 | BECMG 2000 TSRA | 900 | 1100 | Monsoon showers, standing water reported |
| YSSY | 34006KT | CAVOK | – | – | 19 | 9 | 1022 | NOSIG | – | – | Fine and dry |

## A long table: the header should stay pinned while scrolling

| # | Flight | Origin | Destination | Block (h) | Fuel (kg) | Payload (kg) | Load factor |
|---|---|---|---|---|---|---|---|
| 1 | EK405 | NRT | JFK | 11.1 | 29,000 | 42,000 | 59.1% |
| 2 | EK520 | LHR | YYZ | 5.0 | 31,000 | 35,000 | 73.4% |
| 3 | EK565 | HKG | LHR | 7.9 | 125,000 | 44,000 | 60.4% |
| 4 | EK643 | HKG | NRT | 10.2 | 27,000 | 44,000 | 80.8% |
| 5 | EK048 | LHR | SYD | 9.8 | 37,000 | 26,000 | 73.4% |
| 6 | EK316 | SYD | FRA | 9.8 | 107,000 | 19,000 | 59.5% |
| 7 | EK100 | SIN | DEL | 9.7 | 28,000 | 44,000 | 57.6% |
| 8 | EK697 | SIN | HKG | 9.4 | 119,000 | 28,000 | 75.5% |
| 9 | EK307 | YYZ | DEL | 5.5 | 43,000 | 52,000 | 89.3% |
| 10 | EK308 | JFK | FRA | 9.4 | 132,000 | 29,000 | 87.1% |
| 11 | EK075 | FRA | AKL | 3.7 | 73,000 | 18,000 | 88.3% |
| 12 | EK501 | BOM | YYZ | 7.9 | 105,000 | 12,000 | 88.6% |
| 13 | EK712 | NRT | DEL | 6.9 | 83,000 | 45,000 | 90.1% |
| 14 | EK096 | JFK | GRU | 15.2 | 80,000 | 52,000 | 84.2% |
| 15 | EK719 | LHR | LAX | 6.3 | 93,000 | 51,000 | 91.2% |
| 16 | EK396 | FRA | LAX | 14.4 | 64,000 | 9,000 | 96.4% |
| 17 | EK626 | LAX | JFK | 3.6 | 27,000 | 21,000 | 88.8% |
| 18 | EK254 | BOM | LAX | 7.6 | 137,000 | 39,000 | 58.5% |
| 19 | EK563 | YYZ | SIN | 5.9 | 37,000 | 35,000 | 93.0% |
| 20 | EK426 | CDG | LAX | 15.8 | 107,000 | 32,000 | 97.1% |
| 21 | EK181 | BOM | LHR | 4.1 | 104,000 | 22,000 | 55.5% |
| 22 | EK289 | DEL | BOM | 2.1 | 73,000 | 42,000 | 71.2% |
| 23 | EK708 | NRT | JFK | 14.0 | 99,000 | 49,000 | 84.8% |
| 24 | EK922 | LHR | HKG | 14.2 | 131,000 | 51,000 | 90.1% |
| 25 | EK409 | JNB | SIN | 7.5 | 81,000 | 48,000 | 72.6% |
| 26 | EK214 | SIN | LHR | 8.2 | 34,000 | 29,000 | 81.4% |
| 27 | EK581 | SYD | DXB | 4.1 | 32,000 | 31,000 | 82.0% |
| 28 | EK213 | JFK | GRU | 10.6 | 39,000 | 48,000 | 66.1% |
| 29 | EK373 | LAX | FRA | 8.6 | 34,000 | 39,000 | 98.7% |
| 30 | EK496 | YYZ | HKG | 6.4 | 38,000 | 14,000 | 88.0% |
| 31 | EK849 | CDG | HKG | 11.7 | 86,000 | 9,000 | 64.0% |
| 32 | EK707 | LAX | JFK | 9.6 | 23,000 | 41,000 | 68.1% |
| 33 | EK866 | JFK | LAX | 5.7 | 66,000 | 18,000 | 70.7% |
| 34 | EK555 | HKG | CDG | 12.9 | 62,000 | 48,000 | 64.8% |
| 35 | EK246 | SIN | JNB | 13.5 | 114,000 | 22,000 | 63.8% |
| 36 | EK749 | AKL | DEL | 2.4 | 23,000 | 25,000 | 75.8% |
| 37 | EK620 | SIN | LAX | 15.4 | 77,000 | 30,000 | 97.0% |
| 38 | EK226 | LAX | LHR | 3.4 | 80,000 | 20,000 | 69.9% |
| 39 | EK922 | AKL | FRA | 10.5 | 20,000 | 38,000 | 95.0% |
| 40 | EK659 | LAX | JNB | 3.2 | 104,000 | 15,000 | 95.0% |
| 41 | EK911 | SIN | HKG | 4.5 | 121,000 | 48,000 | 69.6% |
| 42 | EK412 | JNB | HKG | 12.4 | 30,000 | 18,000 | 62.5% |
| 43 | EK155 | BOM | DXB | 10.3 | 79,000 | 49,000 | 61.4% |
| 44 | EK960 | AKL | NRT | 6.9 | 90,000 | 43,000 | 60.8% |
| 45 | EK995 | DXB | JNB | 12.2 | 33,000 | 41,000 | 88.0% |
| 46 | EK893 | BOM | SIN | 4.7 | 131,000 | 21,000 | 56.2% |
| 47 | EK514 | SIN | BOM | 5.4 | 95,000 | 28,000 | 66.4% |
| 48 | EK135 | GRU | AKL | 2.9 | 114,000 | 30,000 | 94.5% |
| 49 | EK940 | GRU | AKL | 14.3 | 36,000 | 42,000 | 61.7% |
| 50 | EK451 | DXB | GRU | 12.9 | 97,000 | 8,000 | 89.1% |
| 51 | EK145 | BOM | JFK | 8.6 | 112,000 | 15,000 | 79.5% |
| 52 | EK531 | NRT | AKL | 9.4 | 81,000 | 14,000 | 93.9% |
| 53 | EK196 | LHR | SYD | 5.9 | 118,000 | 14,000 | 77.3% |
| 54 | EK916 | DXB | JNB | 14.8 | 76,000 | 28,000 | 82.0% |
| 55 | EK284 | SIN | LAX | 8.3 | 88,000 | 38,000 | 77.3% |
| 56 | EK536 | HKG | LAX | 14.3 | 140,000 | 24,000 | 95.6% |
| 57 | EK459 | SIN | GRU | 3.9 | 35,000 | 33,000 | 74.5% |
| 58 | EK247 | JFK | NRT | 8.0 | 47,000 | 50,000 | 68.3% |
| 59 | EK796 | SYD | YYZ | 4.2 | 111,000 | 49,000 | 84.1% |
| 60 | EK905 | BOM | AKL | 3.9 | 79,000 | 22,000 | 87.9% |
| 61 | EK907 | SYD | SIN | 8.8 | 105,000 | 22,000 | 62.1% |
| 62 | EK414 | GRU | CDG | 6.7 | 45,000 | 30,000 | 69.0% |
| 63 | EK347 | LAX | DXB | 9.8 | 76,000 | 9,000 | 71.9% |
| 64 | EK984 | FRA | CDG | 2.9 | 137,000 | 22,000 | 97.8% |
| 65 | EK272 | SYD | LHR | 5.8 | 135,000 | 19,000 | 66.9% |
| 66 | EK433 | BOM | GRU | 13.9 | 106,000 | 24,000 | 72.9% |
| 67 | EK335 | AKL | LAX | 3.3 | 27,000 | 52,000 | 63.1% |
| 68 | EK961 | JFK | BOM | 2.2 | 31,000 | 24,000 | 58.7% |
| 69 | EK271 | HKG | LHR | 14.1 | 78,000 | 8,000 | 69.9% |
| 70 | EK938 | GRU | YYZ | 5.8 | 36,000 | 10,000 | 78.2% |
| 71 | EK993 | HKG | LHR | 4.3 | 26,000 | 19,000 | 63.9% |
| 72 | EK313 | FRA | NRT | 9.4 | 46,000 | 26,000 | 74.6% |
| 73 | EK356 | DEL | BOM | 13.3 | 52,000 | 10,000 | 55.7% |
| 74 | EK487 | SIN | CDG | 5.4 | 77,000 | 14,000 | 84.0% |
| 75 | EK507 | GRU | NRT | 9.6 | 133,000 | 33,000 | 97.7% |
| 76 | EK221 | FRA | LAX | 15.8 | 63,000 | 20,000 | 91.6% |
| 77 | EK356 | BOM | SIN | 15.7 | 127,000 | 16,000 | 55.6% |
| 78 | EK168 | CDG | SIN | 2.8 | 105,000 | 32,000 | 93.3% |
| 79 | EK249 | FRA | AKL | 11.7 | 25,000 | 37,000 | 63.2% |
| 80 | EK004 | CDG | HKG | 5.7 | 62,000 | 43,000 | 69.2% |

The table ends here, and prose resumes at its usual measure.
