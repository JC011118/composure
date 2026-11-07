import raw from './questions.json';
import { validateQuestionBank } from '../engine/questions';
import type { Question } from '../engine/types';

export const QUESTION_BANK: readonly Question[] = validateQuestionBank(raw);
export { READING_PASSAGE } from './passage';
