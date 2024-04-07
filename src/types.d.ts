declare module "@nlpjs/lang-en" {
  export class StemmerEn {
    stemWord(word: string): string;
    stem(words: string[]): string[];
  }
}
