# The Quiet Page

*An essay on reading, attention and the space between lines*

## I. What the eye actually does

Nobody reads a line of text the way they think they do. The eye does not glide; it jumps. It lands on a word, takes in a little to either side, and leaps again, perhaps eight or nine characters further on. Each landing lasts about a quarter of a second. Between landings, during the leap itself, you are effectively blind, and the brain quietly stitches the fragments into the smooth experience we call reading. The whole performance is so practised that it feels like nothing at all.

That illusion is fragile. Set a line too long and the eye, arriving at the right-hand margin, must make a long sweep back to find the start of the next one. Miss it by a line and you read the same sentence twice, or skip one without noticing. Set a line too short and the eye spends its life on the return journey, never settling into a rhythm. Somewhere between these failures lies a comfortable measure, and printers found it long before anyone had the instruments to explain why. Their rule of thumb (forty-five to seventy-five characters, with something near sixty-six as the ideal) has survived five centuries of changing taste because it fits the machinery of the eye.

The same is true of the space between lines, which typographers still call *leading*, after the strips of lead that compositors once slid between rows of metal type. Too little and the lines crowd one another, so that the descenders of one row seem to tangle with the ascenders of the next. Too much and the lines drift apart into separate islands, and the page loses its texture. Good leading is felt rather than seen. It gives each line enough air to be distinct, and not so much that the paragraph stops being a single thing.

### Saccades and the shape of words

Psychologists call the leaps *saccades* and the pauses *fixations*. Experienced readers make fewer fixations per line than beginners, and they skip short, predictable words almost entirely: "the", "of", "and". What they are taking in, much of the time, is the outline of a word rather than its letters one by one. This is why text set entirely in capitals is slower to read. CAPITALS HAVE NO ASCENDERS OR DESCENDERS, SO EVERY WORD BECOMES THE SAME RECTANGLE, and the eye loses one of its best cues. A short run of capitals, an acronym such as NASA or ICAO, is harmless; a whole paragraph of them is a small act of hostility.

## II. The page as a landscape

Look at a well-set page from arm's length, so that the words blur, and you will see something like a landscape: an even grey field, with paragraphs as gentle undulations and headings as landmarks. The typographer's job is to keep that field even. Rivers of white space running down through justified text break it up; so do lines that are much looser or tighter than their neighbours, and widows (a single short word stranded on the last line of a paragraph).

Modern browsers can now help with some of this. A rule called `text-wrap: pretty` asks the layout engine to consider a whole paragraph before deciding where to break its lines, rather than filling each line greedily and leaving the consequences to the last one. The difference is small on any single paragraph and large across a long document. It is the sort of improvement that nobody will ever consciously notice, which is exactly the point.

> The best typography is invisible. It does not ask to be admired; it asks to be read, and then it gets out of the way.

Hyphenation is the other old tool. In a justified column it is almost obligatory, because without it the spaces between words must stretch to fill each line, and some lines will stretch grotesquely. With ragged-right setting, which leaves the right-hand edge uneven, hyphenation matters less, and many readers prefer to do without it. Neither choice is wrong. They are different bargains between evenness of texture and the small interruption of a broken word.

### Numbers in running text

Figures deserve their own care. In a sentence, numbers should sit comfortably among lower-case letters, which is why many book faces offer *old-style* figures that rise and fall like the letters around them: the year 1923, the price of 48 rupees, the 3,000 metres of runway at the end of a long flight. In a table the opposite is true. There, figures must line up in columns, each the same width and height, so that 1,111 and 8,888 occupy the same space and a column can be scanned at a glance.

## III. Attention is the scarce resource

There is a reason this matters more now than it did. A printed book makes a single demand on its reader; a screen makes dozens. Every notification, badge and blinking cursor is a small tug on attention, and attention, once broken, takes time to rebuild. Researchers who study office work have found that it can take many minutes to return fully to a task after an interruption, and that people interrupted often begin to interrupt themselves, checking for messages that have not arrived.

Reading is one of the few activities that rewards sustained attention so directly. A difficult argument, a long novel, a technical manual that must be understood rather than skimmed: each asks the reader to hold many things in mind at once, and each repays the effort in a way that fragments never can. A reading environment that protects that state — no clutter, no chrome, nothing moving in the corner of the eye — is not a luxury. It is the precondition for a certain kind of thought.

1. Remove everything that is not the text.
2. Make what remains comfortable to read for an hour.
3. Let the reader mark what matters without leaving the page.

That last point is easy to overlook. Serious readers write in their books. They underline, bracket and scribble in the margins, and the marks become a second layer of the text: a record of what struck them, and a map for the next reading. An application that makes the reader switch into some other mode to do this has misunderstood what reading is.

### The cost of a switch

Switching modes is itself a small interruption. If highlighting a sentence means opening a menu, choosing a colour, confirming and returning, the reader has been pulled out of the text four times to mark it once. The better design lets the hand move as it would with a pen: select, tap a colour, carry on. The mark should appear immediately, look like something a person would make, and stay out of the way of the words beneath it.

## IV. Of margins and silence

The margin is the most undervalued part of a page. In a printed book it frames the text, gives the thumbs somewhere to rest, and lets the block of type sit on the paper rather than crowding its edges. On a screen it has an extra job: it is where everything that is not the text can live without intruding. A table of contents in the margin, set small and faint, can be there when wanted and invisible when not, like a pencilled note that only comes into focus when you look for it.

Silence works the same way. A page that is mostly white is not empty; it is giving the reader room. The temptation in software is to fill every space with something useful, and the result is usually a page on which nothing is easy to find, because everything is shouting. The discipline of leaving things out is harder than the discipline of putting them in, and it is felt by every reader even when it cannot be named.

### Colour, briefly

Pure black text on pure white is harsher than it needs to be on a backlit screen, which is why most reading applications soften one or both. A warm off-white page with near-black ink reads like good paper. Dark themes benefit from the same restraint, and from one less obvious adjustment: light text on a dark background appears bolder than dark text on light, so a slightly lighter weight restores the balance.[^1]

## V. Tables, and other awkward guests

Not everything a reader meets is prose. Technical documents are full of tables, and tables do not fit comfortably in a column designed for sentences. A table squeezed to the width of a paragraph becomes a thicket of wrapped cells; a table allowed to run off the edge of the screen becomes a puzzle. The sensible compromise is to let a wide table step out of the column into the margins, centred, while the prose around it keeps its measure. Short columns should never wrap. Long text columns should wrap at a sensible width. And sideways scrolling should be a last resort, not a default.

The same thinking applies to code, quotations and lists. Each is a different texture laid into the field of the page, and each needs just enough distinction to be recognised — a change of face, a little indent, a quiet rule — and no more.

```
def comfortable_measure(chars_per_line):
    # Bringhurst: 45 to 75 characters; 66 is widely regarded as ideal.
    return 45 <= chars_per_line <= 75
```

## VI. A reading room of one's own

What, in the end, should a reader's tool do? It should open a document instantly, because waiting is an interruption. It should set the text beautifully by default, because most people never change a default. It should let the reader adjust size, spacing and colour to their own eyes, because eyes differ and so do rooms and hours. It should let them mark what matters in place. And then it should be quiet.

This is a modest ambition. It does not involve artificial intelligence, collaboration, sync or a subscription. It is closer to the ambition of a good bookbinder or a careful printer: to make an object that serves the text and the person holding it, and asks for nothing in return. There are not many such tools left. It seems worth making one.

---

### A note on sources

The figures here — the length of a fixation, the span of a saccade, the comfortable measure — are approximate, drawn from a century of reading research and five centuries of printers' practice. They vary from reader to reader and from page to page. Treat them as a starting point for your own eyes, which are the only authority that matters for the page in front of you…

[^1]: The effect is called irradiation. Bright areas appear to spread into dark ones, so pale strokes on a dark ground look thicker than they are.
