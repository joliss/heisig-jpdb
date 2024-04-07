import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";
import axios from "axios";
import * as cheerio from "cheerio";
import memoizeFs from "../node_modules/memoize-fs/dist/index.js";
import { StemmerEn } from "@nlpjs/lang-en";

let csvInputString = readFileSync(
  "vendor/heisig-kanjis/heisig-kanjis.csv",
  "utf8"
);

const memoizer = memoizeFs({ cachePath: "./.cache" });

interface HeisigKanji {
  kanji: string;
  id_5th_ed: string;
  id_6th_ed: string;
  keyword_5th_ed: string;
  keyword_6th_ed: string;
  components: string;
  on_reading: string;
  kun_reading: string;
  stroke_count: string;
  jlpt: string;
}

type Edition = "5" | "6";

interface KanjiInfo {
  kanji: string;
  heisigId: Record<Edition, number | null>;
  heisigKeyword: Record<Edition, string>;
  heisigKeywordStem: Record<Edition, string>;
  jpdbKeyword: string;
  jpdbKeywordStem: string;
}

let heisigKanjis = Papa.parse(csvInputString, {
  header: true,
  skipEmptyLines: true,
}).data as HeisigKanji[];

let sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function getUrl(url: string): Promise<string> {
  console.error(`Fetching ${url}`);
  let response = await axios.get(url);
  // The server blocks us if we go faster
  await sleep(1000);
  return response.data;
}

export async function extractKeywordForKanji(kanji: string): Promise<string> {
  let url = `https://jpdb.io/kanji/${kanji}`;
  // Fetch the HTML content of the page
  let getUrlCached = await memoizer.fn(getUrl, {
    cacheId: "getUrl",
    noBody: true,
  });
  let responseData = await getUrlCached(url);
  let $ = cheerio.load(responseData);
  let keyword: string = $('.subsection-label:contains("Keyword") + .subsection')
    .text()
    .trim();
  return keyword;
}

let stemmer = new StemmerEn();

export async function getKanjiInfos(): Promise<KanjiInfo[]> {
  function maybeParseInt(value: string): number | null {
    return value !== "" ? parseInt(value) : null;
  }

  let kanjiInfos: KanjiInfo[] = [];
  for (let heisigKanji of heisigKanjis) {
    let jpdbKeyword = await extractKeywordForKanji(heisigKanji.kanji);
    kanjiInfos.push({
      kanji: heisigKanji.kanji,
      heisigId: {
        "5": maybeParseInt(heisigKanji.id_5th_ed),
        "6": maybeParseInt(heisigKanji.id_6th_ed),
      },
      heisigKeyword: {
        "5": heisigKanji.keyword_5th_ed,
        "6": heisigKanji.keyword_6th_ed,
      },
      heisigKeywordStem: {
        "5": stemmer.stemWord(heisigKanji.keyword_5th_ed),
        "6": stemmer.stemWord(heisigKanji.keyword_6th_ed),
      },
      jpdbKeyword: jpdbKeyword,
      jpdbKeywordStem: stemmer.stemWord(jpdbKeyword),
    });
  }
  return kanjiInfos;
}

export function getCollisions(
  kanjiInfos: KanjiInfo[],
  currentKanji: KanjiInfo,
  edition: Edition,
  keywordStem: string
): KanjiInfo[] {
  return kanjiInfos.filter(
    (kanjiInfo) =>
      kanjiInfo !== currentKanji &&
      (kanjiInfo.heisigKeywordStem[edition] === keywordStem ||
        kanjiInfo.jpdbKeywordStem === keywordStem)
  );
}

function getHtml(kanjiInfos: KanjiInfo[], edition: Edition): string {
  // Please excuse the unsafe string interpolation everywhere. We choose to
  // trust our scraped source data.

  function kanjiLink(kanjiInfo: KanjiInfo): string {
    return `<a href="#${kanjiInfo.kanji}">${kanjiInfo.kanji}</a>`;
  }

  function kanjiLinks(kanjiInfos: KanjiInfo[]): string {
    if (kanjiInfos.length === 0) return "";
    return `(${kanjiInfos.map(kanjiLink).join(", ")})`;
  }

  let title = `Kanji Keywords: Heisig ${edition}th Edition vs. jpdb.io`;
  let jpdbIo = `<a href="https://jpdb.io">jpdb.io</a>`;
  let lastUpdated = new Date().toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
  return `<!DOCTYPE html>
    <!-- This HTML file was automatically generated by a script. Do not edit it manually. -->
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
        <link rel="stylesheet" href="https://joliss.github.io/heisig-jpdb/assets/css/style.css">
        <style>
          h1 {
            margin-bottom: 10px;
          }
          table {
            border-collapse: collapse;
          }
          th, td {
            border: 1px solid black;
            padding: 0.5em;
            text-align: left;
          }
          .is-different {
            background-color: #eee;
          }
          .container {
            max-width: 768px;
            margin-right: auto;
            margin-left: auto;
            padding-left: 16px;
            padding-right: 16px;
            margin-top: 16px;
            margin-bottom: 16px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <p>
            <a href="./">Back to home page</a>
          </p>
          <h1>${title}</h1>
          <p>
            This comparison table shows the kanji keywords for Heisig's <i>Remembering the Kanji, <b>${edition}th</b> Edition</i>, and ${jpdbIo} (as of ${lastUpdated}).
          </p>
          <p>
            Possible keyword collisions are indicated in parentheses.
            In order to catch as many possible collisions as possible, we use the stem of the keyword for comparison, but note that it is not 100% reliable.
          </p>
          <p>
            You can also download this table as a <a href="kanji-keywords-${edition}th-edition.csv">CSV file</a>.
          </p>
          <table>
            <thead>
              <tr>
                <th>Heisig #</th>
                <th>Kanji</th>
                <th>Heisig Keyword</th>
                <th>jpdb Keyword</th>
              </tr>
            </thead>
            <tbody>
              ${kanjiInfos
                .map((kanjiInfo) => {
                  let isDifferentClass =
                    kanjiInfo.heisigKeyword[edition] !== kanjiInfo.jpdbKeyword
                      ? "is-different"
                      : "";
                  let jpdbCollisions = getCollisions(
                    kanjiInfos,
                    kanjiInfo,
                    edition,
                    kanjiInfo.jpdbKeywordStem
                  );
                  let heisigCollisions = getCollisions(
                    kanjiInfos,
                    kanjiInfo,
                    edition,
                    kanjiInfo.heisigKeywordStem[edition]
                  );
                  function linkAnchor(text: string): string {
                    return `<a href="#${kanjiInfo.kanji}" style="color: inherit;">${text}</a>`;
                  }
                  return `
                    <tr id="${kanjiInfo.kanji}" class="${isDifferentClass}">
                      <td>${linkAnchor(
                        kanjiInfo.heisigId[edition]
                          ?.toString()
                          .padStart(4, "0")!
                      )}</td>
                      <td>${linkAnchor(kanjiInfo.kanji)}</td>
                      <td>
                        <a href="https://kanji.koohii.com/study/kanji/${
                          kanjiInfo.kanji
                        }"><!--
                          -->${kanjiInfo.heisigKeyword[edition]}<!--
                        --></a>
                        ${kanjiLinks(heisigCollisions)}
                      </td>
                      <td>
                        <a href="https://jpdb.io/kanji/${kanjiInfo.kanji}"><!--
                          -->${kanjiInfo.jpdbKeyword}<!--
                        --></a>
                          ${kanjiLinks(jpdbCollisions)}
                      </td>
                    </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

interface CsvOutputRow {
  kanji: string;
  heisigId: string;
  heisigKeyword: string;
  heisigCollisions: string;
  jpdbKeyword: string;
  jpdbCollisions: string;
}

function getCsv(kanjiInfosForEdition: KanjiInfo[], edition: Edition): string {
  let csvRows: CsvOutputRow[] = kanjiInfosForEdition.map((kanjiInfo) => {
    function collisionsFor(keywordStem: string): string {
      return getCollisions(
        kanjiInfosForEdition,
        kanjiInfo,
        edition,
        keywordStem
      )
        .map((kanjiInfo) => kanjiInfo.kanji)
        .join(" ");
    }
    return {
      kanji: kanjiInfo.kanji,
      heisigId: kanjiInfo.heisigId[edition]!.toString(),
      heisigKeyword: kanjiInfo.heisigKeyword[edition],
      heisigCollisions: collisionsFor(kanjiInfo.heisigKeywordStem[edition]),
      jpdbKeyword: kanjiInfo.jpdbKeyword,
      jpdbCollisions: collisionsFor(kanjiInfo.jpdbKeywordStem),
    };
  });
  return Papa.unparse(csvRows);
}

async function main() {
  let kanjiInfos = await getKanjiInfos();
  for (let edition of ["5", "6"] as Edition[]) {
    let outFileBase = `docs/kanji-keywords-${edition}th-edition`;
    let kanjiInfosForEdition = kanjiInfos
      .filter((kanjiInfo) => kanjiInfo.heisigId[edition] != null)
      .toSorted((a, b) => a.heisigId[edition]! - b.heisigId[edition]!);
    writeFileSync(`${outFileBase}.csv`, getCsv(kanjiInfosForEdition, edition));
    writeFileSync(
      `${outFileBase}.html`,
      getHtml(kanjiInfosForEdition, edition)
    );
    console.log(`Wrote ${outFileBase}.csv and ${outFileBase}.html`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
