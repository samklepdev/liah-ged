import { masteringGedContent, type MasteringGedBlock } from '../content/mastering-the-ged-test';

function Block({ block }: { block: MasteringGedBlock }) {
  switch (block.type) {
    case 'heading':
      return <h2>{block.text}</h2>;
    case 'subheading':
      return <h3>{block.text}</h3>;
    case 'paragraph':
      return <p>{block.text}</p>;
    case 'bullets':
      return (
        <ul>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
  }
}

export function MasteringGedTestPage() {
  return (
    <div className="course-content mastering-ged-page">
      <h1>Mastering the GED Test</h1>
      <div className="course-content-body mastering-ged-body">
        {masteringGedContent.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </div>
  );
}
