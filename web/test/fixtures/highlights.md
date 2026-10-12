# Heavily highlighted notes

This page exercises every way a highlight can be written, so each colour and style can be judged in light, sepia and dark themes. Switch the highlight style in the panel to compare Marker, Lowlight and Underline.

## The five colours

==Yellow is the default and is written with double equals signs.== It is the colour most readers reach for first, so it must never overpower the text. <mark style="background: #BBFABBA6;">Green is written as a Highlightr mark tag</mark>, as are <mark style="background: #ADCCFFA6;">blue</mark>, <mark style="background: #FFB8EBA6;">pink</mark> and <mark style="background: #FFB86CA6;">orange</mark>. In a long paragraph the colours should read as a quiet second layer rather than as decoration: ==the reader marked this because it mattered==, and <mark style="background: #ADCCFFA6;">this other passage because it raised a question</mark>, and the eye should be able to pass over both without stumbling.

## Highlights across formatting

A highlight can ==span **bold** text and *italic* text== in one go, or sit ==inside **a bold phrase**== or **wrap ==part of one==**. It can include ==a [link to somewhere](https://example.com) in the middle== and ==`inline code`== too. A highlight that ends with punctuation ==should look right at the end of a sentence.== And one that begins at a quotation mark: =="Curly quotes inside a highlight," she said.==

Highlights placed back to back: ==first== <mark style="background: #BBFABBA6;">second</mark> <mark style="background: #FFB8EBA6;">third</mark> ==fourth== — they should remain distinct, with neither the fills nor the underlines merging into a stripe.

A highlight that runs long enough to wrap across several lines tests how the marker style handles line breaks: ==each line fragment should get its own rounded ends, as if the reader had lifted the pen at the end of every line and put it down again at the start of the next one, which is what a real highlighter does on paper.==

## Foreign and legacy forms

These come from other tools and older notes, and must still display sensibly.

- Highlightr in class mode: <mark class="hltr-pink">pink by class name</mark> and <mark class="hltr-green">green by class name</mark>.
- Colours outside the five slots: <mark style="background: #FF5582A6;">a red from Highlightr</mark> and <mark style="background: #D2B3FFA6;">a purple</mark> map to the nearest slot, so they still adapt to dark mode.
- A bare <mark>mark tag with no colour</mark> is treated as yellow.
- Escaped equals signs are not highlights: \==not highlighted\==, and neither is a=b==c in an equation, nor `==code==`.
- Three equals signs are not a highlight either: ===nope===.

## Highlights in other places

### A ==highlighted== heading

> A quotation with ==a highlighted phrase== in it, and <mark style="background: #ADCCFFA6;">a blue one</mark>.

> [!note] A callout with a highlight
> The ==important part== of a note should stand out inside a callout too.

1. A numbered item with ==a highlight==.
2. Another with <mark style="background: #FFB86CA6;">an orange one</mark>.
   - A nested item with ==yellow== and <mark style="background: #BBFABBA6;">green</mark> together.

| Term | Meaning |
| --- | --- |
| ==Leading== | The space between lines of type |
| <mark style="background: #FFB8EBA6;">Measure</mark> | The length of a line, in characters |

## A dense page of marks

The density test: a reader who highlights a great deal. ==The first claim is the strongest.== It is followed by evidence, <mark style="background: #ADCCFFA6;">some of which the reader doubted</mark>, and by a counter-argument that ==turned out to be decisive==. A second paragraph adds context. <mark style="background: #BBFABBA6;">The author's own summary is careful and fair.</mark> Then comes a long digression that nobody highlighted, which is useful for judging how marked and unmarked text sit together on the page and whether the marks make the plain text look neglected. <mark style="background: #FFB8EBA6;">A memorable phrase</mark> closes the section, followed by <mark style="background: #FFB86CA6;">an action item for later</mark>.
