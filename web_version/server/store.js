import { TABLES, dataToRow, rowToData, idProblem, fileNameProblem, MAX_FILE_CHARS, MAX_ID } from './tables.js';

// IDs handed to one page load. A browser numbers the projects, characters and
// backgrounds it creates itself, the way ScratchJr expects to, so two pages
// open at once for the same student (two tabs, or two PCs) must never pick the
// same number. Each page load therefore gets a block of its own.
export const ID_BLOCK = 1000;

const MAX_OPS = 500;

export class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

export class Store {
  constructor(prisma) {
    this.prisma = prisma;
  }

  // Everything the browser rebuilds its local tables from, plus its ID block.
  async state(userId) {
    const where = {where: {userId}, orderBy: {localId: 'asc'}};
    const [projects, shapes, backgrounds] = await this.prisma.$transaction([
      this.prisma.project.findMany(where),
      this.prisma.shape.findMany(where),
      this.prisma.background.findMany(where),
    ]);
    const highest = Math.max(0, ...[projects, shapes, backgrounds].flat().map(r => r.localId));
    return {
      idBlockStart: await this.reserveIdBlock(userId, highest),
      idBlockSize: ID_BLOCK,
      projects: projects.map(r => dataToRow('PROJECTS', r)),
      shapes: shapes.map(r => dataToRow('USERSHAPES', r)),
      backgrounds: backgrounds.map(r => dataToRow('USERBKGS', r)),
    };
  }

  // Two single-statement updates, so two page loads at the same moment still
  // get different blocks without needing a transaction.
  async reserveIdBlock(userId, highest) {
    await this.prisma.user.updateMany({where: {id: userId, idCursor: {lte: highest}}, data: {idCursor: highest + 1}});
    const user = await this.prisma.user.update({where: {id: userId}, data: {idCursor: {increment: ID_BLOCK}}});
    const start = user.idCursor - ID_BLOCK;
    if (user.idCursor > MAX_ID) throw new Error('This account has used up its project numbers.');
    return start;
  }

  // Applies a batch of changes from the browser, all or nothing.
  //   rows:  [{table, id, row}] - row null deletes it
  //   files: [{name, contents}] - contents null deletes it
  async sync(userId, {rows = [], files = []} = {}) {
    if (!Array.isArray(rows) || !Array.isArray(files)) throw new BadRequest('rows and files must be lists.');
    if (rows.length + files.length > MAX_OPS) throw new BadRequest('Too many changes in one request.');

    const operations = [];
    for (const file of files) {
      const problem = fileNameProblem(file?.name);
      if (problem) throw new BadRequest(problem);
      if (file.contents === null) {
        operations.push(this.prisma.mediaFile.deleteMany({where: {userId, name: file.name}}));
        continue;
      }
      if (typeof file.contents !== 'string' || file.contents.length > MAX_FILE_CHARS) throw new BadRequest(`${file.name} is not a file ScratchJr can keep.`);
      operations.push(this.prisma.mediaFile.upsert({
        where: {userId_name: {userId, name: file.name}},
        create: {userId, name: file.name, contents: file.contents},
        update: {contents: file.contents},
      }));
    }

    for (const change of rows) {
      const definition = TABLES[change?.table];
      if (!definition) throw new BadRequest(`Unknown table ${change?.table}.`);
      const problem = idProblem(change.id);
      if (problem) throw new BadRequest(problem);
      const model = this.prisma[definition.model];
      if (change.row === null) {
        operations.push(model.deleteMany({where: {userId, localId: change.id}}));
        continue;
      }
      let data;
      try { data = rowToData(change.table, change.row); } catch (error) { throw new BadRequest(error.message); }
      operations.push(model.upsert({
        where: {userId_localId: {userId, localId: change.id}},
        create: {userId, localId: change.id, ...data},
        update: data,
      }));
    }

    if (operations.length) await this.prisma.$transaction(operations);
    return {applied: operations.length};
  }

  async file(userId, name) {
    if (fileNameProblem(name)) return null;
    const file = await this.prisma.mediaFile.findUnique({where: {userId_name: {userId, name}}});
    return file ? file.contents : null;
  }

  // What the desktop app's DatabaseManager.cleanProjectFiles does: drop files of
  // one type that no project, character or background refers to any more.
  async clean(userId, type) {
    if (!/^[a-z0-9]{1,8}$/.test(type || '')) throw new BadRequest('Unknown file type.');
    // ScratchJr asks for wav; recordings made in a browser are webm.
    const extension = type === 'wav' ? 'webm' : type;
    const [files, projects, shapes, backgrounds] = await this.prisma.$transaction([
      this.prisma.mediaFile.findMany({where: {userId, name: {endsWith: `.${extension}`}}, select: {name: true}}),
      this.prisma.project.findMany({where: {userId}, select: {json: true}}),
      this.prisma.shape.findMany({where: {userId}, select: {md5: true}}),
      this.prisma.background.findMany({where: {userId}, select: {md5: true}}),
    ]);
    const used = new Set([...shapes, ...backgrounds].map(r => r.md5));
    const unused = files.map(f => f.name).filter(name => !used.has(name) && !projects.some(p => p.json && p.json.includes(name)));
    if (unused.length) await this.prisma.mediaFile.deleteMany({where: {userId, name: {in: unused}}});
    return {removed: unused.length};
  }
}
