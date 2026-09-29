/** Provider-independent text generation boundary. No SDK types cross this interface. */
export interface TextGenerator {
  generate(prompt: string): Promise<string>;
}

export class TextGenerationError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TextGenerationError';
  }
}
