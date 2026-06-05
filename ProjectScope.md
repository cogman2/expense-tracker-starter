ProjectScope.md

### Problem
This is a customer service situation where customers problems are given tickets. Those tickets are solved by customer service people. It is very time-consuming and slow.

### Solution
An customer service person reads the problem and checks to see if there is an answer in the database. If there is, he hands it to claude to make the answer sound friendly and human. That answer is sent back to the customer.
If there is not an answer in the database, the question is given to a customer service person who answers it and sends the answer to the customer.

### Features
1. The tickets are ordered and sorted and displayed.
2. They are first read by an AI.
3. The AI will look up answers to customer problems in the knowledge database. 
4. When the AI finds a strong match in the database, it will personalize the answer and sent it to the customer.
5. If the AI does not find a strong answer it will hand it to a customer service representative who will write an answer.
6. After the ustomer service representative writes the answer, the AI will rewrite it for clarity and understandability.