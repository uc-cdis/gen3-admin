import NestedCollapses from "@/components/NestedCollapse";

import { Title } from "@mantine/core";

const parsedData = {
  "name": "test",
  "description": "test",
  "editable": true,
  "number": 12345,
  "environments": [
    {
      "name": "test",
      "description": "test",
      "environments": [
        {
          "environment": "test",
          "description": "test",
        }
      ]
    }
  ]
};


function Test() {
  return (
    <div>
      <Title>Hello</Title>
      <div style={{ marginTop: '20px' }}>
        <NestedCollapses data={parsedData} />
      </div>

    </div>
  );
}

export default Test;